export type MetricId = 'cpu' | 'memory' | 'network' | 'disk';

export type MetricSummary = {
  mean: number[];
  p90: number[];
  p99: number[];
  max: number[];
};

export type Manifest = {
  version: number;
  dataset: string;
  generatedAt: string;
  subsetMode: string;
  usageRowCount: number;
  machineCount: number;
  failureDomainCount: number;
  binSeconds: number;
  periodSeconds: number;
  binCount: number;
  missingValue: number;
  artifacts?: {
    machineGrid: string;
    containerGrid: string;
    batchGrid: string;
    batchTaskDag: string;
  };
  containerMetaRowCount?: number;
  containerRowCount?: number;
  batchTaskRowCount?: number;
  batchInstanceRowCount?: number;
  metrics: Array<{
    id: MetricId;
    label: string;
    unit: string;
    description: string;
  }>;
  defaultWindow: {
    startBin: number;
    endBin: number;
  };
  notes: string[];
  sources: Record<string, string>;
};

export type MachineRecord = {
  index: number;
  machineId: string;
  failureDomain1: string;
  failureDomain2: string;
  cpuNum: number;
  memSize: number;
  status: string;
  events: Array<{ time: number; status: string }>;
  availableBins: number;
  globalPeakScore: number;
  globalPeakMetric: MetricId;
  peakBin: number;
};

export type MachinesFile = {
  machines: MachineRecord[];
};

export type ClusterSummary = {
  times: number[];
  metrics: Record<MetricId, MetricSummary>;
};

export type Hotspot = {
  id: string;
  title: string;
  summary: string;
  metricId: MetricId;
  startBin: number;
  endBin: number;
  peakBin: number;
  peakValue: number;
  score: number;
  machineId: string;
  machineIndex: number;
  domainId: string;
};

export type HotspotsFile = {
  highlights: Hotspot[];
  findings: string[];
};

export type DomainRecord = {
  domainId: string;
  label: string;
  machineCount: number;
  machineIndices: number[];
  globalPeakScore: number;
  peakMetric: MetricId;
};

export type DomainsFile = {
  domains: DomainRecord[];
};

export type AppData = {
  manifest: Manifest;
  machines: MachinesFile;
  summary: ClusterSummary;
  hotspots: HotspotsFile;
  domains: DomainsFile;
};

export type WindowMachineStat = {
  machineIndex: number;
  machine: MachineRecord;
  domainId: string;
  averages: Record<MetricId, number>;
  counts: Record<MetricId, number>;
  peaks: Record<MetricId, number>;
  windowPeak: number;
  peakMetric: MetricId;
  peakValue: number;
};

export type DomainWindowStat = {
  domain: DomainRecord;
  mean: number;
  peak: number;
  machineCount: number;
};

export type GridData = {
  bytes: Uint8Array;
  missingValue: number;
  metricCount: number;
  machineCount: number;
  binCount: number;
};

export type ContainerGrid = {
  values: Uint16Array;
  machineCount: number;
  binCount: number;
};

export type BatchGrid = {
  bytes: Uint8Array;
  missingValue: number;
  metricCount: number;
  machineCount: number;
  binCount: number;
};

export type TaskDag = {
  window: {
    startBin: number;
    endBin: number;
  };
  nodes: Array<{
    id: string;
    jobName: string;
    taskName: string;
    type: string;
    startBin: number;
    endBin: number;
    x: number;
    y: number;
    resourceScore: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
  }>;
  notes?: string[];
};

export type AppState = {
  metricId: MetricId;
  timeWindow: [number, number];
  activeDomainId: string | null;
  selectedMachineIndex: number | null;
  machineFilterIndices: number[] | null;
};
