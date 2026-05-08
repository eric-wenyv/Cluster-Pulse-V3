<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTooltip } from '../composables/useTooltip';
import { computeBatchSeries, computeContainerSeries, renderMirrorChart } from '../core/draw/hero-charts';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();
const tooltip = useTooltip();

const containerRef = ref<HTMLElement | null>(null);
const mirrorChartRef = ref<SVGSVGElement | null>(null);

let resizeObserver: ResizeObserver | null = null;

const isReady = computed(() => !!store.data && !!store.containerGrid && !!store.batchGrid);

const containerSeries = computed(() => {
  if (!store.data || !store.containerGrid) return [];
  return computeContainerSeries(store.containerGrid, store.data.manifest.binCount, store.data.manifest.machineCount);
});

const batchSeries = computed(() => {
  if (!store.data || !store.batchGrid) return [];
  return computeBatchSeries(store.batchGrid, store.data.manifest.binCount, store.data.manifest.machineCount);
});

function redrawMirrorChart() {
  if (!mirrorChartRef.value || !store.data || !containerSeries.value.length || !batchSeries.value.length) return;
  renderMirrorChart(mirrorChartRef.value, store.data, {
    metricId: store.metricId,
    timeWindow: store.timeWindow,
    activeDomainId: store.activeDomainId,
    selectedMachineIndex: store.selectedMachineIndex,
    machineFilterIndices: store.machineFilterIndices
  }, containerSeries.value, batchSeries.value, {
    showTooltip: (x, y, html) => tooltip.show(x, y, html),
    hideTooltip: () => tooltip.hide()
  });
}

watch(
  () => [store.metricId, store.timeWindow[0], store.timeWindow[1], isReady.value],
  () => {
    if (isReady.value) {
      redrawMirrorChart();
    }
  },
  { flush: 'post' }
);

onMounted(async () => {
  await store.ensureContainerGrid();
  await store.ensureBatchGrid();
  
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (isReady.value) redrawMirrorChart();
    });
    resizeObserver.observe(containerRef.value);
  }
  
  if (isReady.value) {
    redrawMirrorChart();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div ref="containerRef" class="panel mirror-panel">
    <div class="panel-header">
      <span>在线 vs 批处理混部</span>
      <span class="legend-badges">
        <span class="badge"><span class="badge-dot" style="background-color: #178f8f"></span>在线容器 ▲</span>
        <span class="badge"><span class="badge-dot" style="background-color: #d66d2e"></span>批处理任务 ▼</span>
      </span>
    </div>
    <div class="svg-container">
      <svg ref="mirrorChartRef" class="mirror-svg"></svg>
    </div>
  </div>
</template>

<style scoped>
.mirror-panel {
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  height: 100%;
}

.panel-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 8px 12px;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.85);
  border-bottom: 1px solid var(--line);
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  pointer-events: none;
}

.legend-badges {
  display: flex;
  gap: 10px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface-soft);
  color: var(--muted);
  border: 1px solid var(--line);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.svg-container {
  flex: 1;
  min-height: 0;
  padding-top: 35px;
  background: var(--surface-soft);
}

.mirror-svg {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
