import { METRIC_ORDER } from './constants';
import type { AppData, AppState, GridData, MetricId, WindowMachineStat } from './types';
import { computeAverage, gridValue } from './utils';

export function getMachineFilterKey(machineFilterIndices: number[] | null): string {
  return machineFilterIndices?.join(',') ?? 'all';
}

export function normalizeMachineFilter(machineFilterIndices: number[] | null, visibleMachineIndices: number[]): number[] | null {
  if (!machineFilterIndices?.length) {
    return null;
  }
  const visibleMachineSet = new Set(visibleMachineIndices);
  const normalized = machineFilterIndices.filter((machineIndex) => visibleMachineSet.has(machineIndex));
  if (!normalized.length || normalized.length === visibleMachineIndices.length) {
    return null;
  }
  return normalized;
}

export function getFilteredMachineIndices(machineFilterIndices: number[] | null, visibleMachineIndices: number[]): number[] {
  if (!machineFilterIndices?.length) {
    return visibleMachineIndices;
  }
  const visibleMachineSet = new Set(visibleMachineIndices);
  const filtered = machineFilterIndices.filter((machineIndex) => visibleMachineSet.has(machineIndex));
  return filtered.length ? filtered : visibleMachineIndices;
}

export function getVisibleMachineIndices(params: {
  data: AppData;
  state: AppState;
  cachedVisibleIndicesKey: string;
  cachedVisibleMachineIndices: number[];
  machineMetricPeaks: Record<MetricId, number[]> | null;
  grid: GridData | null;
}): { cacheKey: string; visibleMachineIndices: number[]; machineMetricPeaks: Record<MetricId, number[]> | null } {
  const { data, state, cachedVisibleIndicesKey, cachedVisibleMachineIndices, machineMetricPeaks, grid } = params;
  const cacheKey = `${state.metricId}:${state.activeDomainId ?? 'all'}`;
  if (cachedVisibleIndicesKey === cacheKey) {
    return { cacheKey, visibleMachineIndices: cachedVisibleMachineIndices, machineMetricPeaks };
  }

  const resolvedPeaks = getMachineMetricPeaks(data, grid, machineMetricPeaks);
  let allVisible = !state.activeDomainId
    ? data.machines.machines.map((machine) => machine.index)
    : (data.domains.domains.find((domain) => domain.domainId === state.activeDomainId)?.machineIndices ?? []);

  const metricPeaks = resolvedPeaks[state.metricId];
  allVisible = [...allVisible].sort((left, right) => {
    const leftPeak = metricPeaks[left] ?? 0;
    const rightPeak = metricPeaks[right] ?? 0;
    if (rightPeak !== leftPeak) {
      return rightPeak - leftPeak;
    }
    const leftScore = data.machines.machines[left]?.globalPeakScore ?? 0;
    const rightScore = data.machines.machines[right]?.globalPeakScore ?? 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return left - right;
  });

  return {
    cacheKey,
    visibleMachineIndices: allVisible.length > 48 ? allVisible.slice(0, 48) : allVisible,
    machineMetricPeaks: resolvedPeaks
  };
}

export function getMachineMetricPeaks(
  data: AppData,
  grid: GridData | null,
  machineMetricPeaks: Record<MetricId, number[]> | null
): Record<MetricId, number[]> {
  if (machineMetricPeaks) {
    return machineMetricPeaks;
  }
  const machineCount = data.manifest.machineCount;
  const peaks: Record<MetricId, number[]> = {
    cpu: new Array(machineCount).fill(0),
    memory: new Array(machineCount).fill(0),
    network: new Array(machineCount).fill(0),
    disk: new Array(machineCount).fill(0)
  };
  if (!grid) {
    return peaks;
  }
  METRIC_ORDER.forEach((metricId) => {
    for (let machineIndex = 0; machineIndex < machineCount; machineIndex += 1) {
      let peak = 0;
      for (let binIndex = 0; binIndex < data.manifest.binCount; binIndex += 1) {
        peak = Math.max(peak, gridValue(grid, metricId, binIndex, machineIndex) ?? 0);
      }
      peaks[metricId][machineIndex] = peak;
    }
  });
  return peaks;
}

export function getWindowMachineStats(params: {
  data: AppData;
  state: AppState;
  grid: GridData | null;
  filteredMachineIndices: number[];
  cachedWindowStatsKey: string;
  cachedWindowStats: WindowMachineStat[];
  machineFilterKey: string;
}): { cacheKey: string; stats: WindowMachineStat[] } {
  const { data, state, grid, filteredMachineIndices, cachedWindowStatsKey, cachedWindowStats, machineFilterKey } = params;
  if (!grid) {
    return { cacheKey: cachedWindowStatsKey, stats: [] };
  }
  const cacheKey = `${state.metricId}:${state.activeDomainId ?? 'all'}:${state.timeWindow[0]}:${state.timeWindow[1]}:${machineFilterKey}`;
  if (cachedWindowStatsKey === cacheKey) {
    return { cacheKey, stats: cachedWindowStats };
  }

  const [startBin, endBin] = state.timeWindow;
  const visibleIndices = new Set(filteredMachineIndices);
  const stats: WindowMachineStat[] = [];

  data.machines.machines.forEach((machine) => {
    if (!visibleIndices.has(machine.index)) {
      return;
    }
    const valuesByMetric: Record<MetricId, number[]> = { cpu: [], memory: [], network: [], disk: [] };
    const peaksByMetric: Record<MetricId, number> = { cpu: 0, memory: 0, network: 0, disk: 0 };
    let peakMetric: MetricId = 'cpu';
    let peakValue = -1;

    for (let binIndex = startBin; binIndex <= endBin; binIndex += 1) {
      METRIC_ORDER.forEach((metricId) => {
        const value = gridValue(grid, metricId, binIndex, machine.index);
        if (value === null) {
          return;
        }
        valuesByMetric[metricId].push(value);
        peaksByMetric[metricId] = Math.max(peaksByMetric[metricId], value);
        if (value > peakValue) {
          peakValue = value;
          peakMetric = metricId;
        }
      });
    }

    const allCounts = METRIC_ORDER.reduce((sum, metricId) => sum + valuesByMetric[metricId].length, 0);
    if (allCounts === 0) {
      return;
    }

    stats.push({
      machineIndex: machine.index,
      machine,
      domainId: machine.failureDomain1,
      averages: {
        cpu: computeAverage(valuesByMetric.cpu),
        memory: computeAverage(valuesByMetric.memory),
        network: computeAverage(valuesByMetric.network),
        disk: computeAverage(valuesByMetric.disk)
      },
      counts: {
        cpu: valuesByMetric.cpu.length,
        memory: valuesByMetric.memory.length,
        network: valuesByMetric.network.length,
        disk: valuesByMetric.disk.length
      },
      peaks: peaksByMetric,
      peakMetric,
      windowPeak: Math.max(peakValue, 0),
      peakValue
    });
  });

  const selectedMetric = state.metricId;
  stats.sort((left, right) => {
    const peakDelta = right.peaks[selectedMetric] - left.peaks[selectedMetric];
    if (peakDelta !== 0) {
      return peakDelta;
    }
    const averageDelta = right.averages[selectedMetric] - left.averages[selectedMetric];
    if (averageDelta !== 0) {
      return averageDelta;
    }
    return right.windowPeak - left.windowPeak;
  });

  return { cacheKey, stats };
}
