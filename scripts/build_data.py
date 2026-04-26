#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import struct
import tarfile
from array import array
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from heapq import heappush, heapreplace
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Sequence, Set, Tuple

METRICS = ("cpu", "memory", "network", "disk")
METRIC_LABELS = {
    "cpu": "CPU",
    "memory": "Memory",
    "network": "Network",
    "disk": "Disk",
}
METRIC_DESCRIPTIONS = {
    "cpu": "15 分钟粒度的平均 CPU 利用率。",
    "memory": "15 分钟粒度的平均内存利用率。",
    "network": "15 分钟粒度内网络收发峰值（max(net_in, net_out)）。",
    "disk": "15 分钟粒度的平均磁盘 IO 利用率。",
}
MISSING_VALUE = 255
HIGHLIGHT_WINDOW_RADIUS = 4
ARTIFACTS = {
    "machineGrid": "machine-grid.bin",
    "containerGrid": "containers_per_machine_per_bin.bin",
    "batchGrid": "batch_load_per_machine_per_bin.bin",
    "batchTaskDag": "batch_task_dag.json",
}
BATCH_DAG_NODE_LIMIT = 200


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Cluster Pulse static data bundle.")
    parser.add_argument("--input-root", default="data/raw", help="Directory with full raw archives or extracted csv files.")
    parser.add_argument("--fallback-root", default="data/raw-sample", help="Directory with sampled csv files.")
    parser.add_argument("--output-root", default="public/data", help="Directory for generated JSON/BIN artifacts.")
    parser.add_argument("--bin-seconds", type=int, default=900, help="Aggregation bin size in seconds.")
    parser.add_argument("--period-seconds", type=int, default=8 * 24 * 60 * 60, help="Expected total time range.")
    return parser.parse_args()


def round_float(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def percentile(sorted_values: Sequence[int], q: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
      return float(sorted_values[lower])
    lower_value = sorted_values[lower]
    upper_value = sorted_values[upper]
    return float(lower_value + (upper_value - lower_value) * (position - lower))


def format_time_range(start_bin: int, end_bin: int, bin_seconds: int) -> str:
    start = start_bin * bin_seconds
    end = (end_bin + 1) * bin_seconds
    return f"{format_seconds(start)} - {format_seconds(end)}"


def format_seconds(value: int) -> str:
    hours = value // 3600
    minutes = (value % 3600) // 60
    days = hours // 24
    hh = hours % 24
    if days > 0:
        return f"D{days + 1} {hh:02d}:{minutes:02d}"
    return f"{hh:02d}:{minutes:02d}"


@contextmanager
def open_csv_source(path: Path) -> Iterator[io.TextIOBase]:
    if path.suffixes[-2:] == [".tar", ".gz"]:
        archive = tarfile.open(path, "r:gz")
        members = [member for member in archive.getmembers() if member.isfile()]
        if not members:
            archive.close()
            raise FileNotFoundError(f"No file found inside archive: {path}")
        extracted = archive.extractfile(members[0])
        if extracted is None:
            archive.close()
            raise FileNotFoundError(f"Unable to extract member from archive: {path}")
        wrapper = io.TextIOWrapper(extracted, encoding="utf-8", newline="")
        try:
            yield wrapper
        finally:
            wrapper.close()
            archive.close()
    else:
        with path.open("r", encoding="utf-8", newline="") as handle:
            yield handle


def locate_input_file(root: Path, candidates: Sequence[str]) -> Optional[Path]:
    for candidate in candidates:
        file_path = root / candidate
        if file_path.exists():
            return file_path
    return None


def resolve_source_file(primary_root: Path, fallback_root: Path, candidates: Sequence[str]) -> Optional[Path]:
    for root in (primary_root, fallback_root):
        file_path = locate_input_file(root, candidates)
        if file_path:
            return file_path
    return None


def is_fallback_path(path: Path, fallback_root: Path) -> bool:
    try:
        path.resolve().relative_to(fallback_root.resolve())
        return True
    except ValueError:
        return False


def resolve_sources(primary_root: Path, fallback_root: Path) -> Tuple[Dict[str, Optional[Path]], str]:
    candidates = {
        "machine_meta": ("machine_meta.csv", "machine_meta.tar.gz"),
        "machine_usage": ("machine_usage.csv", "machine_usage_sample.csv", "machine_usage.tar.gz"),
        "container_meta": ("container_meta.csv", "container_meta_sample.csv", "container_meta.tar.gz"),
        "container_usage": ("container_usage.csv", "container_usage_sample.csv", "container_usage.tar.gz"),
        "batch_task": ("batch_task.csv", "batch_task_sample.csv", "batch_task.tar.gz"),
        "batch_instance": ("batch_instance.csv", "batch_instance_sample.csv", "batch_instance.tar.gz"),
    }
    sources = {
        source_name: resolve_source_file(primary_root, fallback_root, source_candidates)
        for source_name, source_candidates in candidates.items()
    }
    if not sources["machine_meta"] or not sources["machine_usage"]:
        raise FileNotFoundError(
            f"Unable to locate machine_meta and machine_usage under {primary_root} or {fallback_root}"
        )

    subset_mode = "full"
    for source_path in sources.values():
        if source_path and ("sample" in source_path.name or is_fallback_path(source_path, fallback_root)):
            subset_mode = "sample"
            break
    return sources, subset_mode


def parse_int(value: str) -> int:
    return int(float(value))


def parse_metric_value(value: str) -> Optional[float]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    number = float(value)
    if number < 0 or number > 100 or number in (-1, 101):
        return None
    return number


def parse_network(net_in: str, net_out: str) -> Optional[float]:
    in_value = parse_metric_value(net_in)
    out_value = parse_metric_value(net_out)
    if in_value is None and out_value is None:
        return None
    candidates = [value for value in (in_value, out_value) if value is not None]
    return max(candidates) if candidates else None


def load_machine_meta(meta_path: Path) -> Dict[str, dict]:
    records: Dict[str, dict] = {}
    with open_csv_source(meta_path) as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 7:
                continue
            machine_id = row[0].strip()
            time_stamp = parse_int(row[1])
            failure_domain_1 = row[2].strip()
            failure_domain_2 = row[3].strip()
            cpu_num = parse_int(row[4])
            mem_size = parse_int(row[5])
            status = row[6].strip()

            record = records.setdefault(
                machine_id,
                {
                    "machine_id": machine_id,
                    "failure_domain_1": failure_domain_1,
                    "failure_domain_2": failure_domain_2,
                    "cpu_num": cpu_num,
                    "mem_size": mem_size,
                    "status": status,
                    "events": [],
                    "last_time": -1,
                },
            )
            if time_stamp >= record["last_time"]:
                record["failure_domain_1"] = failure_domain_1
                record["failure_domain_2"] = failure_domain_2
                record["cpu_num"] = cpu_num
                record["mem_size"] = mem_size
                record["status"] = status
                record["last_time"] = time_stamp

            events: List[dict] = record["events"]
            if not events or events[-1]["time"] != time_stamp or events[-1]["status"] != status:
                events.append({"time": time_stamp, "status": status})

    return records


def build_machine_index(meta_records: Dict[str, dict]) -> Tuple[List[str], Dict[str, int]]:
    machine_ids = sorted(
        meta_records,
        key=lambda machine_id: (
            int(meta_records[machine_id]["failure_domain_1"]),
            meta_records[machine_id]["failure_domain_2"],
            machine_id,
        ),
    )
    return machine_ids, {machine_id: index for index, machine_id in enumerate(machine_ids)}


def aggregate_usage(
    usage_path: Path,
    machine_lookup: Dict[str, int],
    machine_count: int,
    bin_count: int,
    bin_seconds: int,
) -> Tuple[List[bytearray], List[List[int]], List[int], int]:
    cell_count = machine_count * bin_count
    sums = [array("f", [0.0]) * cell_count for _ in METRICS]
    counts = [array("I", [0]) * cell_count for _ in METRICS]
    aggregated = [bytearray([MISSING_VALUE]) * cell_count for _ in METRICS]
    histograms = [[0] * 101 for _ in METRICS]
    seen_machines = [0] * machine_count
    row_count = 0

    with open_csv_source(usage_path) as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 9:
                continue
            machine_id = row[0].strip()
            machine_index = machine_lookup.get(machine_id)
            if machine_index is None:
                continue
            timestamp = parse_int(row[1])
            if timestamp < 0:
                continue
            bin_index = timestamp // bin_seconds
            if bin_index < 0 or bin_index >= bin_count:
                continue

            row_count += 1
            seen_machines[machine_index] = 1
            cell_index = machine_index * bin_count + bin_index
            values = (
                parse_metric_value(row[2]),
                parse_metric_value(row[3]),
                parse_network(row[6], row[7]),
                parse_metric_value(row[8]),
            )

            for metric_index, value in enumerate(values):
                if value is None:
                    continue
                sums[metric_index][cell_index] += value
                counts[metric_index][cell_index] += 1

    for metric_index in range(len(METRICS)):
        metric_sum = sums[metric_index]
        metric_count = counts[metric_index]
        metric_output = aggregated[metric_index]
        histogram = histograms[metric_index]
        for cell_index in range(cell_count):
            count = metric_count[cell_index]
            if count == 0:
                continue
            value = int(round(metric_sum[cell_index] / count))
            value = max(0, min(100, value))
            metric_output[cell_index] = value
            histogram[value] += 1

    return aggregated, histograms, seen_machines, row_count


def cdf_lookup(histogram: List[int]) -> List[float]:
    total = sum(histogram)
    if total == 0:
        return [0.0] * len(histogram)
    cumulative = 0
    lookup = []
    for count in histogram:
        cumulative += count
        lookup.append(cumulative / total)
    return lookup


def build_filtered_machine_metadata(
    machine_ids: List[str],
    meta_records: Dict[str, dict],
    seen_machines: List[int],
    aggregated: List[bytearray],
    bin_count: int,
    quantiles: List[List[float]],
) -> Tuple[List[int], List[dict], List[Tuple[float, int, int, int]], Dict[str, List[int]]]:
    filtered_old_indices: List[int] = []
    machines_payload: List[dict] = []
    candidate_heap: List[Tuple[float, int, int, int, int]] = []
    domain_to_indices: Dict[str, List[int]] = defaultdict(list)

    for old_index, machine_id in enumerate(machine_ids):
        if not seen_machines[old_index]:
            continue

        best_score = -1.0
        best_metric_index = 0
        best_bin = 0
        valid_bins = 0
        for bin_index in range(bin_count):
            cell_index = old_index * bin_count + bin_index
            metric_scores: List[Tuple[float, int]] = []
            for metric_index, metric_values in enumerate(aggregated):
                value = metric_values[cell_index]
                if value == MISSING_VALUE:
                    continue
                metric_scores.append((quantiles[metric_index][value], metric_index))
            if metric_scores:
                valid_bins += 1
                score, metric_index = max(metric_scores, key=lambda item: item[0])
                if score > best_score:
                    best_score = score
                    best_metric_index = metric_index
                    best_bin = bin_index
                    peak_value = aggregated[metric_index][cell_index]
                    candidate = (score, peak_value, old_index, bin_index, best_metric_index)
                    if len(candidate_heap) < 256:
                        heappush(candidate_heap, candidate)
                    elif candidate > candidate_heap[0]:
                        heapreplace(candidate_heap, candidate)

        if valid_bins == 0:
            continue

        filtered_index = len(filtered_old_indices)
        filtered_old_indices.append(old_index)
        meta = meta_records[machine_id]
        domain_id = str(meta["failure_domain_1"])
        domain_to_indices[domain_id].append(filtered_index)
        machines_payload.append(
            {
                "index": filtered_index,
                "machineId": machine_id,
                "failureDomain1": domain_id,
                "failureDomain2": str(meta["failure_domain_2"]),
                "cpuNum": int(meta["cpu_num"]),
                "memSize": int(meta["mem_size"]),
                "status": meta["status"],
                "events": meta["events"][:12],
                "availableBins": valid_bins,
                "globalPeakScore": round_float(best_score, 4),
                "globalPeakMetric": METRICS[best_metric_index],
                "peakBin": best_bin,
            }
        )

    return filtered_old_indices, machines_payload, sorted(candidate_heap, reverse=True), domain_to_indices


def build_metric_grid(
    aggregated: List[bytearray],
    filtered_old_indices: List[int],
    bin_count: int,
) -> bytearray:
    machine_count = len(filtered_old_indices)
    metric_count = len(METRICS)
    output = bytearray([MISSING_VALUE]) * (metric_count * bin_count * machine_count)
    for metric_index, metric_values in enumerate(aggregated):
        metric_offset = metric_index * bin_count * machine_count
        for bin_index in range(bin_count):
            bin_offset = metric_offset + bin_index * machine_count
            for new_index, old_index in enumerate(filtered_old_indices):
                old_cell = old_index * bin_count + bin_index
                output[bin_offset + new_index] = metric_values[old_cell]
    return output


def load_container_meta(container_meta_path: Optional[Path]) -> Tuple[Dict[str, dict], int]:
    if container_meta_path is None:
        return {}, 0
    records: Dict[str, dict] = {}
    row_count = 0
    with open_csv_source(container_meta_path) as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 8:
                continue
            container_id = row[0].strip()
            if not container_id:
                continue
            row_count += 1
            timestamp = parse_int(row[2])
            existing = records.get(container_id)
            if existing and timestamp < existing["time_stamp"]:
                continue
            records[container_id] = {
                "container_id": container_id,
                "machine_id": row[1].strip(),
                "time_stamp": timestamp,
                "app_du": row[3].strip(),
                "status": row[4].strip(),
                "cpu_request": parse_int(row[5]),
                "cpu_limit": parse_int(row[6]),
                "mem_size": float(row[7]),
            }
    return records, row_count


def aggregate_container_counts(
    container_usage_path: Optional[Path],
    machine_lookup: Dict[str, int],
    bin_count: int,
    bin_seconds: int,
) -> Tuple[array, int]:
    machine_count = len(machine_lookup)
    cell_count = machine_count * bin_count
    counts = array("H", [0]) * cell_count
    row_count = 0
    if container_usage_path is None:
        return counts, row_count

    cell_containers: Dict[int, Set[str]] = defaultdict(set)
    with open_csv_source(container_usage_path) as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 3:
                continue
            container_id = row[0].strip()
            machine_index = machine_lookup.get(row[1].strip())
            if not container_id or machine_index is None:
                continue
            timestamp = parse_int(row[2])
            if timestamp < 0:
                continue
            bin_index = timestamp // bin_seconds
            if bin_index < 0 or bin_index >= bin_count:
                continue
            row_count += 1
            cell_containers[machine_index * bin_count + bin_index].add(container_id)

    for cell_index, container_ids in cell_containers.items():
        counts[cell_index] = min(len(container_ids), 65535)
    return counts, row_count


def build_container_grid(container_counts: array, filtered_old_indices: List[int], bin_count: int) -> bytearray:
    machine_count = len(filtered_old_indices)
    output = bytearray(machine_count * bin_count * 2)
    for bin_index in range(bin_count):
        for new_index, old_index in enumerate(filtered_old_indices):
            old_cell = old_index * bin_count + bin_index
            output_offset = (bin_index * machine_count + new_index) * 2
            struct.pack_into("<H", output, output_offset, container_counts[old_cell])
    return output


def load_batch_tasks(batch_task_path: Optional[Path], bin_count: int, bin_seconds: int) -> Tuple[Dict[Tuple[str, str], dict], int]:
    if batch_task_path is None:
        return {}, 0
    tasks: Dict[Tuple[str, str], dict] = {}
    row_count = 0
    with open_csv_source(batch_task_path) as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 9:
                continue
            task_name = row[0].strip()
            job_name = row[2].strip()
            if not task_name or not job_name:
                continue
            start_time = parse_int(row[5])
            end_time = parse_int(row[6])
            if end_time < start_time:
                end_time = start_time
            start_bin = max(0, min(bin_count - 1, start_time // bin_seconds))
            end_bin = max(start_bin, min(bin_count - 1, end_time // bin_seconds))
            row_count += 1
            tasks[(job_name, task_name)] = {
                "task_name": task_name,
                "job_name": job_name,
                "instance_num": parse_int(row[1]),
                "task_type": row[3].strip(),
                "status": row[4].strip(),
                "start_time": start_time,
                "end_time": end_time,
                "start_bin": start_bin,
                "end_bin": end_bin,
                "plan_cpu": float(row[7] or 0),
                "plan_mem": float(row[8] or 0),
            }
    return tasks, row_count


def add_weighted_interval(
    totals: array,
    cell_count: int,
    machine_index: int,
    bin_count: int,
    bin_seconds: int,
    start_time: int,
    end_time: int,
    cpu_value: Optional[float],
    memory_value: Optional[float],
) -> None:
    if end_time < start_time:
        end_time = start_time
    end_exclusive = end_time + 1
    start_bin = max(0, min(bin_count - 1, start_time // bin_seconds))
    end_bin = max(start_bin, min(bin_count - 1, end_time // bin_seconds))
    for bin_index in range(start_bin, end_bin + 1):
        bin_start = bin_index * bin_seconds
        bin_end = bin_start + bin_seconds
        overlap = max(0, min(end_exclusive, bin_end) - max(start_time, bin_start))
        if overlap <= 0:
            continue
        weight = overlap / bin_seconds
        cell_index = machine_index * bin_count + bin_index
        if cpu_value is not None:
            totals[cell_index] += cpu_value * weight
        if memory_value is not None:
            totals[cell_count + cell_index] += memory_value * weight


def aggregate_batch_instances(
    batch_instance_path: Optional[Path],
    machine_lookup: Dict[str, int],
    bin_count: int,
    bin_seconds: int,
) -> Tuple[List[bytearray], int, Dict[Tuple[str, str], float]]:
    machine_count = len(machine_lookup)
    cell_count = machine_count * bin_count
    totals = array("f", [0.0]) * (cell_count * 2)
    task_scores: Dict[Tuple[str, str], float] = defaultdict(float)
    row_count = 0
    if batch_instance_path is None:
        return [bytearray([MISSING_VALUE]) * cell_count for _ in METRICS], row_count, task_scores

    with open_csv_source(batch_instance_path) as handle:
        reader = csv.reader(handle)
        for row in reader:
            if len(row) < 14:
                continue
            machine_index = machine_lookup.get(row[7].strip())
            if machine_index is None:
                continue
            start_time = parse_int(row[5])
            end_time = parse_int(row[6])
            if start_time < 0:
                continue
            cpu_value = parse_metric_value(row[10])
            memory_value = parse_metric_value(row[12])
            if cpu_value is None and memory_value is None:
                continue
            row_count += 1
            add_weighted_interval(totals, cell_count, machine_index, bin_count, bin_seconds, start_time, end_time, cpu_value, memory_value)
            task_scores[(row[2].strip(), row[1].strip())] += (cpu_value or 0) + (memory_value or 0)

    aggregated = [bytearray([MISSING_VALUE]) * cell_count for _ in METRICS]
    for cell_index in range(cell_count):
        cpu_total = totals[cell_index]
        memory_total = totals[cell_count + cell_index]
        if cpu_total > 0:
            aggregated[0][cell_index] = max(0, min(100, int(round(cpu_total))))
        if memory_total > 0:
            aggregated[1][cell_index] = max(0, min(100, int(round(memory_total))))
    return aggregated, row_count, task_scores


def build_batch_grid(batch_aggregated: List[bytearray], filtered_old_indices: List[int], bin_count: int) -> bytearray:
    machine_count = len(filtered_old_indices)
    output = bytearray([MISSING_VALUE]) * (len(METRICS) * bin_count * machine_count)
    for metric_index, metric_values in enumerate(batch_aggregated):
        metric_offset = metric_index * bin_count * machine_count
        for bin_index in range(bin_count):
            bin_offset = metric_offset + bin_index * machine_count
            for new_index, old_index in enumerate(filtered_old_indices):
                old_cell = old_index * bin_count + bin_index
                output[bin_offset + new_index] = metric_values[old_cell]
    return output


def build_batch_task_dag(
    tasks: Dict[Tuple[str, str], dict],
    task_scores: Dict[Tuple[str, str], float],
    default_window: dict,
) -> dict:
    start_bin = default_window["startBin"]
    end_bin = default_window["endBin"]
    active_tasks = [
        task
        for key, task in tasks.items()
        if task["start_bin"] <= end_bin and task["end_bin"] >= start_bin and task_scores.get(key, 0) > 0
    ]
    active_tasks.sort(key=lambda task: (-task_scores.get((task["job_name"], task["task_name"]), 0), task["start_bin"], task["job_name"], task["task_name"]))
    selected = active_tasks[:BATCH_DAG_NODE_LIMIT]
    selected.sort(key=lambda task: (task["start_bin"], task["job_name"], task["task_name"]))

    nodes = []
    max_score = max((task_scores.get((task["job_name"], task["task_name"]), 0) for task in selected), default=0)
    for index, task in enumerate(selected):
        score = task_scores.get((task["job_name"], task["task_name"]), 0)
        x = 0.0 if end_bin == start_bin else (task["start_bin"] - start_bin) / max(1, end_bin - start_bin)
        y = 0.5 if len(selected) <= 1 else index / (len(selected) - 1)
        nodes.append(
            {
                "id": f"{task['job_name']}:{task['task_name']}",
                "jobName": task["job_name"],
                "taskName": task["task_name"],
                "type": task["task_type"],
                "startBin": task["start_bin"],
                "endBin": task["end_bin"],
                "x": round_float(max(0.0, min(1.0, x)), 4),
                "y": round_float(y, 4),
                "resourceScore": round_float(score / max_score if max_score else 0.0, 4),
            }
        )

    return {
        "window": {"startBin": start_bin, "endBin": end_bin},
        "nodes": nodes,
        "edges": [],
        "notes": ["DAG edge parsing is unavailable for ambiguous task_name formats; edges are intentionally empty."],
    }


def build_cluster_summary(
    aggregated: List[bytearray],
    filtered_old_indices: List[int],
    bin_count: int,
    bin_seconds: int,
) -> dict:
    metric_payload = {}
    times = [bin_index * bin_seconds for bin_index in range(bin_count)]
    for metric_index, metric_id in enumerate(METRICS):
        metric_values = aggregated[metric_index]
        mean_values = []
        p90_values = []
        p99_values = []
        max_values = []
        for bin_index in range(bin_count):
            values = [
                metric_values[old_index * bin_count + bin_index]
                for old_index in filtered_old_indices
                if metric_values[old_index * bin_count + bin_index] != MISSING_VALUE
            ]
            if not values:
                mean_values.append(0.0)
                p90_values.append(0.0)
                p99_values.append(0.0)
                max_values.append(0.0)
                continue
            values.sort()
            mean_values.append(round_float(sum(values) / len(values)))
            p90_values.append(round_float(percentile(values, 0.9)))
            p99_values.append(round_float(percentile(values, 0.99)))
            max_values.append(round_float(values[-1]))

        metric_payload[metric_id] = {
            "mean": mean_values,
            "p90": p90_values,
            "p99": p99_values,
            "max": max_values,
        }

    return {"times": times, "metrics": metric_payload}


def build_domain_payload(
    domain_to_indices: Dict[str, List[int]],
    machines_payload: List[dict],
) -> dict:
    domains = []
    for domain_id, machine_indices in sorted(domain_to_indices.items(), key=lambda item: int(item[0])):
        peak_machine = max(
            (machines_payload[index] for index in machine_indices),
            key=lambda machine: (machine["globalPeakScore"], machine["availableBins"]),
        )
        domains.append(
            {
                "domainId": domain_id,
                "label": f"FD-{domain_id}",
                "machineCount": len(machine_indices),
                "machineIndices": machine_indices,
                "globalPeakScore": peak_machine["globalPeakScore"],
                "peakMetric": peak_machine["globalPeakMetric"],
            }
        )
    return {"domains": domains}


def build_hotspots_payload(
    candidates: List[Tuple[float, int, int, int, int]],
    filtered_old_indices: List[int],
    machine_ids: List[str],
    meta_records: Dict[str, dict],
    machines_payload: List[dict],
    bin_seconds: int,
    bin_count: int,
) -> dict:
    highlight_records = []
    used_ranges: List[Tuple[int, int]] = []
    old_to_new = {old_index: new_index for new_index, old_index in enumerate(filtered_old_indices)}

    for score, peak_value, old_index, peak_bin, metric_index in candidates:
        start_bin = max(0, peak_bin - HIGHLIGHT_WINDOW_RADIUS)
        end_bin = min(bin_count - 1, peak_bin + HIGHLIGHT_WINDOW_RADIUS)
        overlap = any(not (end_bin < used_start or start_bin > used_end) for used_start, used_end in used_ranges)
        if overlap:
            continue
        machine_id = machine_ids[old_index]
        new_index = old_to_new[old_index]
        meta = meta_records[machine_id]
        metric_id = METRICS[metric_index]
        domain_id = str(meta["failure_domain_1"])
        highlight_records.append(
            {
                "id": f"hotspot-{len(highlight_records) + 1}",
                "title": f"{METRIC_LABELS[metric_id]} 热点窗口 #{len(highlight_records) + 1}",
                "summary": f"{machine_id} 在 {format_time_range(start_bin, end_bin, bin_seconds)} 出现高强度 {METRIC_LABELS[metric_id]} 峰值，位于故障域 FD-{domain_id}。",
                "metricId": metric_id,
                "startBin": start_bin,
                "endBin": end_bin,
                "peakBin": peak_bin,
                "peakValue": peak_value,
                "score": round_float(score, 4),
                "machineId": machine_id,
                "machineIndex": new_index,
                "domainId": domain_id,
            }
        )
        used_ranges.append((start_bin, end_bin))
        if len(highlight_records) == 4:
            break

    findings = []
    if highlight_records:
        first = highlight_records[0]
        findings.append(
            f"最强热点出现在 {format_time_range(first['startBin'], first['endBin'], bin_seconds)}，机器 {first['machineId']} 的 {METRIC_LABELS[first['metricId']]} 峰值达到 {first['peakValue']}。"
        )

    return {"highlights": highlight_records, "findings": findings}


def build_manifest(
    output_root: Path,
    subset_mode: str,
    row_count: int,
    container_meta_row_count: int,
    container_usage_row_count: int,
    batch_task_row_count: int,
    batch_instance_row_count: int,
    machines_payload: List[dict],
    domain_to_indices: Dict[str, List[int]],
    bin_seconds: int,
    period_seconds: int,
    default_window: dict,
) -> dict:
    return {
        "version": 1,
        "dataset": "Alibaba Cluster Trace 2018",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "outputRoot": str(output_root),
        "subsetMode": subset_mode,
        "usageRowCount": row_count,
        "containerMetaRowCount": container_meta_row_count,
        "containerRowCount": container_usage_row_count,
        "batchTaskRowCount": batch_task_row_count,
        "batchInstanceRowCount": batch_instance_row_count,
        "machineCount": len(machines_payload),
        "failureDomainCount": len(domain_to_indices),
        "binSeconds": bin_seconds,
        "periodSeconds": period_seconds,
        "binCount": period_seconds // bin_seconds,
        "missingValue": MISSING_VALUE,
        "metrics": [
            {
                "id": metric_id,
                "label": METRIC_LABELS[metric_id],
                "unit": "%",
                "description": METRIC_DESCRIPTIONS[metric_id],
            }
            for metric_id in METRICS
        ],
        "artifacts": ARTIFACTS,
        "defaultWindow": default_window,
        "notes": [
            "GitHub Pages 发布的是基于真实 Alibaba 2018 trace 的静态聚合结果。",
            "如果当前数据包由 sample 模式生成，则 machine_usage 来自官方压缩文件的流式真实子集。",
            "batch_load_per_machine_per_bin.bin 使用 batch_instance 的 CPU/MEM 字段聚合；network/disk 在原始表中不存在，使用缺失值 255。",
            "batch_task_dag.json 采用确定性坐标；当 task_name 依赖关系无法可靠解析时，edges 保持为空。",
            "完整数据处理可通过 scripts/download_alibaba.sh full 与 npm run data 重新生成。",
        ],
        "sources": {
            "assignmentUrl": "https://bitvis2021.github.io/BITVIS-Course/assignment/assignment2.html",
            "datasetDocsUrl": "https://github.com/alibaba/clusterdata/blob/master/cluster-trace-v2018/trace_2018.md",
            "datasetSchemaUrl": "https://github.com/alibaba/clusterdata/blob/master/cluster-trace-v2018/schema.txt",
            "downloadBaseUrl": "http://aliopentrace.oss-cn-beijing.aliyuncs.com/v2018Traces",
        },
    }


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()
    input_root = Path(args.input_root)
    fallback_root = Path(args.fallback_root)
    output_root = Path(args.output_root)
    output_root.mkdir(parents=True, exist_ok=True)

    sources, subset_mode = resolve_sources(input_root, fallback_root)
    bin_count = args.period_seconds // args.bin_seconds

    meta_path = sources["machine_meta"]
    usage_path = sources["machine_usage"]
    if meta_path is None or usage_path is None:
        raise RuntimeError("machine_meta and machine_usage are required.")

    meta_records = load_machine_meta(meta_path)
    machine_ids, machine_lookup = build_machine_index(meta_records)

    aggregated, histograms, seen_machines, row_count = aggregate_usage(
        usage_path=usage_path,
        machine_lookup=machine_lookup,
        machine_count=len(machine_ids),
        bin_count=bin_count,
        bin_seconds=args.bin_seconds,
    )

    quantiles = [cdf_lookup(histogram) for histogram in histograms]
    filtered_old_indices, machines_payload, candidates, domain_to_indices = build_filtered_machine_metadata(
        machine_ids=machine_ids,
        meta_records=meta_records,
        seen_machines=seen_machines,
        aggregated=aggregated,
        bin_count=bin_count,
        quantiles=quantiles,
    )

    if not filtered_old_indices:
        raise RuntimeError("No usable machine rows found in machine usage data.")

    metric_grid = build_metric_grid(aggregated, filtered_old_indices, bin_count)
    _container_meta_records, container_meta_row_count = load_container_meta(sources["container_meta"])
    container_counts, container_usage_row_count = aggregate_container_counts(
        container_usage_path=sources["container_usage"],
        machine_lookup=machine_lookup,
        bin_count=bin_count,
        bin_seconds=args.bin_seconds,
    )
    container_grid = build_container_grid(container_counts, filtered_old_indices, bin_count)
    batch_tasks, batch_task_row_count = load_batch_tasks(sources["batch_task"], bin_count, args.bin_seconds)
    batch_aggregated, batch_instance_row_count, task_scores = aggregate_batch_instances(
        batch_instance_path=sources["batch_instance"],
        machine_lookup=machine_lookup,
        bin_count=bin_count,
        bin_seconds=args.bin_seconds,
    )
    batch_grid = build_batch_grid(batch_aggregated, filtered_old_indices, bin_count)
    cluster_summary = build_cluster_summary(aggregated, filtered_old_indices, bin_count, args.bin_seconds)
    domains_payload = build_domain_payload(domain_to_indices, machines_payload)
    hotspots_payload = build_hotspots_payload(
        candidates=candidates,
        filtered_old_indices=filtered_old_indices,
        machine_ids=machine_ids,
        meta_records=meta_records,
        machines_payload=machines_payload,
        bin_seconds=args.bin_seconds,
        bin_count=bin_count,
    )

    default_window = hotspots_payload["highlights"][0] if hotspots_payload["highlights"] else {"startBin": 0, "endBin": min(15, bin_count - 1)}
    batch_task_dag = build_batch_task_dag(batch_tasks, task_scores, default_window)
    manifest = build_manifest(
        output_root=output_root,
        subset_mode=subset_mode,
        row_count=row_count,
        container_meta_row_count=container_meta_row_count,
        container_usage_row_count=container_usage_row_count,
        batch_task_row_count=batch_task_row_count,
        batch_instance_row_count=batch_instance_row_count,
        machines_payload=machines_payload,
        domain_to_indices=domain_to_indices,
        bin_seconds=args.bin_seconds,
        period_seconds=args.period_seconds,
        default_window={"startBin": default_window["startBin"], "endBin": default_window["endBin"]},
    )

    write_json(output_root / "manifest.json", manifest)
    write_json(output_root / "machines.json", {"machines": machines_payload})
    write_json(output_root / "cluster-summary.json", cluster_summary)
    write_json(output_root / "hotspots.json", hotspots_payload)
    write_json(output_root / "domains.json", domains_payload)
    write_json(output_root / ARTIFACTS["batchTaskDag"], batch_task_dag)
    (output_root / ARTIFACTS["machineGrid"]).write_bytes(metric_grid)
    (output_root / ARTIFACTS["containerGrid"]).write_bytes(container_grid)
    (output_root / ARTIFACTS["batchGrid"]).write_bytes(batch_grid)

    print(
        f"Built Cluster Pulse data bundle with {len(machines_payload)} machines, "
        f"{len(domain_to_indices)} failure domains, {row_count} usage rows, "
        f"{container_usage_row_count} container rows, {batch_instance_row_count} batch instance rows -> {output_root}"
    )


if __name__ == "__main__":
    main()
