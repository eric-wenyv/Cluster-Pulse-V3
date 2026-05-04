import { defineStore } from 'pinia';
import { computed, ref, shallowRef, watch } from 'vue';
import { loadContainerGrid, loadGrid, loadInitialData } from '../core/data';
import {
  getFilteredMachineIndices,
  getMachineFilterKey,
  getMachineMetricPeaks,
  getVisibleMachineIndices,
  getWindowMachineStats,
  normalizeMachineFilter
} from '../core/selectors';
import type { AppData, ContainerGrid, GridData, Hotspot, MetricId, WindowMachineStat } from '../core/types';
import { clampWindow, isFullWindow } from '../core/utils';

export const useVisualizationStore = defineStore('visualization', () => {
  const data = shallowRef<AppData | null>(null);
  const grid = shallowRef<GridData | null>(null);
  const containerGrid = shallowRef<ContainerGrid | null>(null);
  const metricId = ref<MetricId>('cpu');
  const timeWindow = ref<[number, number]>([0, 0]);
  const zoomedTimeWindow = ref<[number, number] | null>(null);
  const brushTimeWindow = ref<[number, number] | null>(null);
  const activeDomainId = ref<string | null>(null);
  const selectedMachineIndex = ref<number | null>(null);
  const machineFilterIndices = ref<number[] | null>(null);
  const brushMachineIndices = ref<number[] | null>(null);
  const showContainerOverlay = ref(false);

  type ZoomLevel = { timeWindow: [number, number]; machineFilterIndices: number[] | null };
  const zoomStack = ref<ZoomLevel[]>([]);

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

  const isZoomed = computed(() => zoomedTimeWindow.value !== null);

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
    zoomedTimeWindow.value = null;
    brushTimeWindow.value = null;
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

  async function ensureContainerGrid(): Promise<void> {
    if (containerGrid.value || !data.value) {
      return;
    }
    containerGrid.value = await loadContainerGrid(data.value.manifest);
  }

  function toggleContainerOverlay(): void {
    showContainerOverlay.value = !showContainerOverlay.value;
    if (showContainerOverlay.value) {
      ensureContainerGrid();
    }
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
    if (zoomedTimeWindow.value !== null) {
      zoomedTimeWindow.value = next;
    }
  }

  function setActiveDomain(domainId: string | null): void {
    if (activeDomainId.value === domainId) {
      return;
    }
    activeDomainId.value = domainId;
    machineFilterIndices.value = null;
    zoomStack.value = [];
    zoomedTimeWindow.value = null;
    brushTimeWindow.value = null;
    if (data.value) {
      timeWindow.value = [0, data.value.manifest.binCount - 1];
    }
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

  function applyMachineFilter(indices: number[] | null, selectedMachine: number | null): void {
    machineFilterIndices.value = normalizeMachineFilter(indices, visibleMachineIndices.value);
    if (selectedMachine !== null) {
      selectedMachineIndex.value = selectedMachine;
    }
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
    brushMachineIndices.value = null;
    if (payload.selectedMachine !== null) {
      selectedMachineIndex.value = payload.selectedMachine;
    }
  }

  function zoomTo(window: [number, number], nextMachineFilter: number[] | null = null): void {
    if (!data.value) {
      return;
    }
    const next = clampWindow(window, data.value.manifest.binCount);
    zoomStack.value.push({
      timeWindow: [...timeWindow.value] as [number, number],
      machineFilterIndices: machineFilterIndices.value
    });
    zoomedTimeWindow.value = next;
    timeWindow.value = next;
    if (nextMachineFilter !== null) {
      machineFilterIndices.value = normalizeMachineFilter(nextMachineFilter, visibleMachineIndices.value);
    }
  }

  function zoomBack(): void {
    const prev = zoomStack.value.pop();
    if (!prev) {
      return;
    }
    timeWindow.value = prev.timeWindow;
    machineFilterIndices.value = prev.machineFilterIndices;
    if (zoomStack.value.length === 0) {
      zoomedTimeWindow.value = null;
    } else {
      zoomedTimeWindow.value = timeWindow.value;
    }
  }

  function clearZoom(): void {
    zoomStack.value = [];
    zoomedTimeWindow.value = null;
    brushTimeWindow.value = null;
    machineFilterIndices.value = null;
    brushMachineIndices.value = null;
    if (data.value) {
      timeWindow.value = [0, data.value.manifest.binCount - 1];
    }
  }

  function clearHeatmapFilter(): void {
    clearZoom();
  }

  function clearScopeFilter(): void {
    activeDomainId.value = null;
    machineFilterIndices.value = null;
    brushMachineIndices.value = null;
    zoomStack.value = [];
    zoomedTimeWindow.value = null;
    brushTimeWindow.value = null;
  }

  function activateHotspot(hotspot: Hotspot): void {
    if (!data.value) {
      return;
    }
    metricId.value = hotspot.metricId;
    zoomStack.value = [];
    zoomedTimeWindow.value = null;
    brushTimeWindow.value = null;
    timeWindow.value = clampWindow([hotspot.startBin, hotspot.endBin], data.value.manifest.binCount);
    activeDomainId.value = null;
    machineFilterIndices.value = null;
    brushMachineIndices.value = null;
    selectedMachineIndex.value = hotspot.machineIndex;
  }

  return {
    data,
    grid,
    containerGrid,
    metricId,
    timeWindow,
    zoomedTimeWindow,
    brushTimeWindow,
    activeDomainId,
    selectedMachineIndex,
    machineFilterIndices,
    brushMachineIndices,
    showContainerOverlay,
    machineMetricPeaks,
    visibleMachineIndices,
    filteredMachineIndices,
    machineFilterKey,
    isZoomed,
    windowMachineStats,
    selectedMachineStat,
    hasActiveHeatmapFilter,
    hasScopeFilter,
    zoomStack,
    bootstrap,
    ensureGrid,
    ensureContainerGrid,
    toggleContainerOverlay,
    setMetric,
    setTimeWindow,
    setActiveDomain,
    toggleDomain,
    setSelectedMachine,
    setMachineFilter,
    applyMachineFilter,
    applyHeatmapBrush,
    zoomTo,
    zoomBack,
    clearZoom,
    clearHeatmapFilter,
    clearScopeFilter,
    activateHotspot
  };
});

export type VisualizationStore = ReturnType<typeof useVisualizationStore>;
