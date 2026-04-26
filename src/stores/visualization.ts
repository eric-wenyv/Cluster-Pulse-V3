import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { loadGrid, loadInitialData } from '../core/data';
import {
  getFilteredMachineIndices,
  getMachineFilterKey,
  getMachineMetricPeaks,
  getVisibleMachineIndices,
  getWindowMachineStats,
  normalizeMachineFilter
} from '../core/selectors';
import type { AppData, GridData, Hotspot, MetricId, WindowMachineStat } from '../core/types';
import { clampWindow, isFullWindow } from '../core/utils';

export const useVisualizationStore = defineStore('visualization', () => {
  const data = shallowRef<AppData | null>(null);
  const grid = shallowRef<GridData | null>(null);
  const metricId = ref<MetricId>('cpu');
  const timeWindow = ref<[number, number]>([0, 0]);
  const activeDomainId = ref<string | null>(null);
  const selectedMachineIndex = ref<number | null>(null);
  const machineFilterIndices = ref<number[] | null>(null);

  const machineMetricPeaks = computed(() => {
    if (!data.value) {
      return null;
    }
    return getMachineMetricPeaks(data.value, grid.value, null);
  });

  const visibleMachineIndices = computed<number[]>(() => {
    if (!data.value) {
      return [];
    }
    const result = getVisibleMachineIndices({
      data: data.value,
      state: {
        metricId: metricId.value,
        timeWindow: [0, 0],
        activeDomainId: activeDomainId.value,
        selectedMachineIndex: null,
        machineFilterIndices: null
      },
      cachedVisibleIndicesKey: '',
      cachedVisibleMachineIndices: [],
      machineMetricPeaks: machineMetricPeaks.value,
      grid: grid.value
    });
    return result.visibleMachineIndices;
  });

  const filteredMachineIndices = computed<number[]>(() =>
    getFilteredMachineIndices(machineFilterIndices.value, visibleMachineIndices.value)
  );

  const machineFilterKey = computed<string>(() => getMachineFilterKey(machineFilterIndices.value));

  const windowMachineStats = computed<WindowMachineStat[]>(() => {
    if (!data.value || !grid.value) {
      return [];
    }
    const result = getWindowMachineStats({
      data: data.value,
      state: {
        metricId: metricId.value,
        timeWindow: timeWindow.value,
        activeDomainId: activeDomainId.value,
        selectedMachineIndex: null,
        machineFilterIndices: null
      },
      grid: grid.value,
      filteredMachineIndices: filteredMachineIndices.value,
      cachedWindowStatsKey: '',
      cachedWindowStats: [],
      machineFilterKey: machineFilterKey.value
    });
    return result.stats;
  });

  watch(windowMachineStats, (stats) => {
    if (!stats.length) {
      return;
    }
    const found = stats.some((s) => s.machineIndex === selectedMachineIndex.value);
    if (!found) {
      selectedMachineIndex.value = stats[0].machineIndex;
    }
  });

  const selectedMachineStat = computed<WindowMachineStat | null>(() => {
    if (!windowMachineStats.value.length) {
      return null;
    }
    return windowMachineStats.value.find((stat) => stat.machineIndex === selectedMachineIndex.value) ?? windowMachineStats.value[0];
  });

  const hasActiveHeatmapFilter = computed(() => {
    if (!data.value) {
      return false;
    }
    return !isFullWindow(timeWindow.value, data.value.manifest.binCount) || !!machineFilterIndices.value?.length;
  });

  const hasScopeFilter = computed(() => Boolean(activeDomainId.value || machineFilterIndices.value?.length));

  async function bootstrap(): Promise<void> {
    if (data.value) {
      return;
    }
    const appData = await loadInitialData();
    const lead = appData.hotspots.highlights[0];
    metricId.value = lead?.metricId ?? 'cpu';
    timeWindow.value = clampWindow(
      [
        lead?.startBin ?? appData.manifest.defaultWindow.startBin,
        lead?.endBin ?? appData.manifest.defaultWindow.endBin
      ],
      appData.manifest.binCount
    );
    activeDomainId.value = null;
    selectedMachineIndex.value = lead?.machineIndex ?? null;
    machineFilterIndices.value = null;
    data.value = appData;
  }

  async function ensureGrid(): Promise<void> {
    if (grid.value || !data.value) {
      return;
    }
    grid.value = await loadGrid(data.value.manifest);
  }

  function setMetric(id: MetricId): void {
    if (metricId.value === id) {
      return;
    }
    metricId.value = id;
  }

  function setTimeWindow(window: [number, number]): void {
    if (!data.value) {
      return;
    }
    const next = clampWindow(window, data.value.manifest.binCount);
    if (timeWindow.value[0] === next[0] && timeWindow.value[1] === next[1]) {
      return;
    }
    timeWindow.value = next;
  }

  function setActiveDomain(domainId: string | null): void {
    if (activeDomainId.value === domainId) {
      return;
    }
    activeDomainId.value = domainId;
    machineFilterIndices.value = null;
  }

  function toggleDomain(domainId: string): void {
    setActiveDomain(activeDomainId.value === domainId ? null : domainId);
  }

  function setSelectedMachine(index: number | null): void {
    if (selectedMachineIndex.value === index) {
      return;
    }
    selectedMachineIndex.value = index;
  }

  function setMachineFilter(indices: number[] | null): void {
    machineFilterIndices.value = normalizeMachineFilter(indices, visibleMachineIndices.value);
  }

  function applyHeatmapBrush(payload: {
    timeWindow: [number, number];
    machineIndices: number[];
    selectedMachine: number | null;
  }): void {
    if (!data.value) {
      return;
    }
    const next = clampWindow(payload.timeWindow, data.value.manifest.binCount);
    timeWindow.value = next;
    machineFilterIndices.value = normalizeMachineFilter(payload.machineIndices, visibleMachineIndices.value);
    if (payload.selectedMachine !== null) {
      selectedMachineIndex.value = payload.selectedMachine;
    }
  }

  function clearHeatmapFilter(): void {
    if (!data.value) {
      return;
    }
    timeWindow.value = [0, data.value.manifest.binCount - 1];
    machineFilterIndices.value = null;
  }

  function clearScopeFilter(): void {
    activeDomainId.value = null;
    machineFilterIndices.value = null;
  }

  function activateHotspot(hotspot: Hotspot): void {
    if (!data.value) {
      return;
    }
    metricId.value = hotspot.metricId;
    timeWindow.value = clampWindow([hotspot.startBin, hotspot.endBin], data.value.manifest.binCount);
    activeDomainId.value = null;
    machineFilterIndices.value = null;
    selectedMachineIndex.value = hotspot.machineIndex;
  }

  return {
    data,
    grid,
    metricId,
    timeWindow,
    activeDomainId,
    selectedMachineIndex,
    machineFilterIndices,
    machineMetricPeaks,
    visibleMachineIndices,
    filteredMachineIndices,
    machineFilterKey,
    windowMachineStats,
    selectedMachineStat,
    hasActiveHeatmapFilter,
    hasScopeFilter,
    bootstrap,
    ensureGrid,
    setMetric,
    setTimeWindow,
    setActiveDomain,
    toggleDomain,
    setSelectedMachine,
    setMachineFilter,
    applyHeatmapBrush,
    clearHeatmapFilter,
    clearScopeFilter,
    activateHotspot
  };
});

export type VisualizationStore = ReturnType<typeof useVisualizationStore>;
