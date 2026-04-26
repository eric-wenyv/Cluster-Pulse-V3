import { METRIC_ORDER } from './constants';
import type { AppData, BatchGrid, ClusterSummary, ContainerGrid, DomainsFile, GridData, HotspotsFile, MachinesFile, Manifest, TaskDag } from './types';
import { resolveAsset } from './utils';

export async function loadInitialData(): Promise<AppData> {
  const [manifest, machines, summary, hotspots, domains] = await Promise.all([
    loadJson<Manifest>('data/manifest.json'),
    loadJson<MachinesFile>('data/machines.json'),
    loadJson<ClusterSummary>('data/cluster-summary.json'),
    loadJson<HotspotsFile>('data/hotspots.json'),
    loadJson<DomainsFile>('data/domains.json')
  ]);
  return { manifest, machines, summary, hotspots, domains };
}

export async function loadGrid(manifest: Manifest): Promise<GridData> {
  const response = await fetch(resolveAsset(`data/${manifest.artifacts?.machineGrid ?? 'machine-grid.bin'}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch machine-grid.bin: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expectedLength = manifest.machineCount * manifest.binCount * METRIC_ORDER.length;
  if (bytes.length !== expectedLength) {
    throw new Error(`machine-grid.bin length mismatch. Expected ${expectedLength}, received ${bytes.length}.`);
  }
  return {
    bytes,
    missingValue: manifest.missingValue,
    metricCount: METRIC_ORDER.length,
    machineCount: manifest.machineCount,
    binCount: manifest.binCount
  };
}

export async function loadContainerGrid(manifest: Manifest): Promise<ContainerGrid> {
  const fileName = manifest.artifacts?.containerGrid ?? 'containers_per_machine_per_bin.bin';
  const response = await fetch(resolveAsset(`data/${fileName}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fileName}: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const expectedLength = manifest.machineCount * manifest.binCount * 2;
  if (buffer.byteLength !== expectedLength) {
    throw new Error(`${fileName} length mismatch. Expected ${expectedLength}, received ${buffer.byteLength}.`);
  }
  return {
    values: new Uint16Array(buffer),
    machineCount: manifest.machineCount,
    binCount: manifest.binCount
  };
}

export async function loadBatchGrid(manifest: Manifest): Promise<BatchGrid> {
  const fileName = manifest.artifacts?.batchGrid ?? 'batch_load_per_machine_per_bin.bin';
  const response = await fetch(resolveAsset(`data/${fileName}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fileName}: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expectedLength = manifest.machineCount * manifest.binCount * METRIC_ORDER.length;
  if (bytes.length !== expectedLength) {
    throw new Error(`${fileName} length mismatch. Expected ${expectedLength}, received ${bytes.length}.`);
  }
  return {
    bytes,
    missingValue: manifest.missingValue,
    metricCount: METRIC_ORDER.length,
    machineCount: manifest.machineCount,
    binCount: manifest.binCount
  };
}

export async function loadTaskDag(manifest: Manifest): Promise<TaskDag> {
  return loadJson<TaskDag>(`data/${manifest.artifacts?.batchTaskDag ?? 'batch_task_dag.json'}`);
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(resolveAsset(path));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}
