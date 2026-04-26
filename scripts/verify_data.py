#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


REQUIRED_FILES = [
    "manifest.json",
    "machines.json",
    "cluster-summary.json",
    "hotspots.json",
    "domains.json",
    "machine-grid.bin",
    "containers_per_machine_per_bin.bin",
    "batch_load_per_machine_per_bin.bin",
    "batch_task_dag.json",
]


def fail(message: str) -> None:
    raise SystemExit(message)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    if len(sys.argv) < 2:
        fail("Usage: python3 scripts/verify_data.py <data_dir>")

    data_dir = Path(sys.argv[1])
    for file_name in REQUIRED_FILES:
        path = data_dir / file_name
        if not path.exists():
            fail(f"Missing required output file: {path}")

    manifest = load_json(data_dir / "manifest.json")
    machines = load_json(data_dir / "machines.json")["machines"]
    domains = load_json(data_dir / "domains.json")["domains"]
    summary = load_json(data_dir / "cluster-summary.json")
    hotspots = load_json(data_dir / "hotspots.json")["highlights"]
    artifacts = manifest.get(
        "artifacts",
        {
            "machineGrid": "machine-grid.bin",
            "containerGrid": "containers_per_machine_per_bin.bin",
            "batchGrid": "batch_load_per_machine_per_bin.bin",
            "batchTaskDag": "batch_task_dag.json",
        },
    )
    for artifact_name, file_name in artifacts.items():
        if not (data_dir / file_name).exists():
            fail(f"Manifest artifact {artifact_name} points to missing file: {file_name}")

    grid = (data_dir / artifacts["machineGrid"]).read_bytes()
    container_grid = (data_dir / artifacts["containerGrid"]).read_bytes()
    batch_grid = (data_dir / artifacts["batchGrid"]).read_bytes()
    batch_task_dag = load_json(data_dir / artifacts["batchTaskDag"])

    machine_count = len(machines)
    bin_count = manifest["binCount"]
    metric_count = len(manifest["metrics"])
    expected_length = machine_count * bin_count * metric_count
    if len(grid) != expected_length:
        fail(f"{artifacts['machineGrid']} length mismatch: expected {expected_length}, got {len(grid)}")

    expected_container_length = machine_count * bin_count * 2
    if len(container_grid) != expected_container_length:
        fail(f"{artifacts['containerGrid']} length mismatch: expected {expected_container_length}, got {len(container_grid)}")

    expected_batch_length = machine_count * bin_count * metric_count
    if len(batch_grid) != expected_batch_length:
        fail(f"{artifacts['batchGrid']} length mismatch: expected {expected_batch_length}, got {len(batch_grid)}")

    if manifest["machineCount"] != machine_count:
        fail("manifest.machineCount does not match machines.json")

    if len(summary["times"]) != bin_count:
        fail("cluster-summary times length does not match manifest.binCount")

    for metric in manifest["metrics"]:
        metric_id = metric["id"]
        metric_summary = summary["metrics"].get(metric_id)
        if metric_summary is None:
            fail(f"Missing metric summary for {metric_id}")
        for key in ("mean", "p90", "p99", "max"):
            if len(metric_summary[key]) != bin_count:
                fail(f"Metric {metric_id} summary {key} length mismatch")

    machine_indices = {machine["index"] for machine in machines}
    for domain in domains:
        for machine_index in domain["machineIndices"]:
            if machine_index not in machine_indices:
                fail(f"Domain {domain['domainId']} references invalid machine index {machine_index}")

    for highlight in hotspots:
        if highlight["machineIndex"] not in machine_indices:
            fail(f"Invalid machine index in hotspot {highlight['id']}")
        if not (0 <= highlight["startBin"] <= highlight["endBin"] < bin_count):
            fail(f"Invalid time window in hotspot {highlight['id']}")

    if not hotspots:
        fail("Expected at least one hotspot highlight")

    dag_nodes = batch_task_dag.get("nodes", [])
    dag_edges = batch_task_dag.get("edges", [])
    if len(dag_nodes) > 200:
        fail(f"batch_task_dag.json has too many nodes: {len(dag_nodes)}")
    dag_node_ids = {node.get("id") for node in dag_nodes}
    for node in dag_nodes:
        if not (0 <= node["startBin"] <= node["endBin"] < bin_count):
            fail(f"Invalid DAG node time window: {node.get('id')}")
    for edge in dag_edges:
        if edge.get("source") not in dag_node_ids or edge.get("target") not in dag_node_ids:
            fail(f"Invalid DAG edge endpoint: {edge}")

    print(
        f"Verified {data_dir}: {machine_count} machines, {len(domains)} domains, "
        f"{len(hotspots)} hotspots, {len(dag_nodes)} DAG nodes"
    )


if __name__ == "__main__":
    main()

