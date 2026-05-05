<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { METRIC_META } from '../core/constants';
import { renderStreamgraph } from '../core/draw/hero-charts';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();

const containerRef = ref<HTMLElement | null>(null);
const streamgraphRef = ref<SVGSVGElement | null>(null);

let resizeObserver: ResizeObserver | null = null;
let brushSuppressed = false;

const isReady = computed(() => !!store.data);

function redrawStreamgraph() {
  if (!streamgraphRef.value || !store.data) return;
  renderStreamgraph(streamgraphRef.value, store.data, {
    metricId: store.metricId,
    timeWindow: store.timeWindow,
    activeDomainId: store.activeDomainId,
    selectedMachineIndex: store.selectedMachineIndex,
    machineFilterIndices: store.machineFilterIndices
  }, {
    onWindowChange: (window) => {
      if (brushSuppressed) return;
      store.setTimeWindow(window);
    }
  });
}

watch(
  () => [store.metricId, store.timeWindow[0], store.timeWindow[1], isReady.value],
  () => {
    if (isReady.value) {
      brushSuppressed = true;
      redrawStreamgraph();
      brushSuppressed = false;
    }
  },
  { flush: 'post' }
);

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (isReady.value) redrawStreamgraph();
    });
    resizeObserver.observe(containerRef.value);
  }
  
  if (isReady.value) {
    redrawStreamgraph();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

const metricsData = computed(() => {
  if (!store.data) return [];
  return store.data.manifest.metrics.map(m => ({
    id: m.id,
    label: m.label,
    color: METRIC_META[m.id].accent
  }));
});
</script>

<template>
  <div ref="containerRef" class="panel streamgraph-panel">
    <div class="panel-header">
      <div class="title-with-legend">
        <span>全局指标 Streamgraph <span class="sub">8 天 · 15 min bins · P99</span></span>
        <div class="legend">
          <span v-for="m in metricsData" :key="m.id" class="legend-item">
            <span class="legend-color" :style="{ backgroundColor: m.color, opacity: m.id === store.metricId ? 1 : 0.4 }"></span>
            <span class="legend-label" :class="{ 'is-active': m.id === store.metricId }">{{ m.label }}</span>
          </span>
        </div>
      </div>
      <span style="color:var(--muted); font-size: 0.85rem">拖动选择窗口</span>
    </div>
    <div class="svg-container">
      <svg ref="streamgraphRef" class="streamgraph-svg"></svg>
    </div>
  </div>
</template>

<style scoped>
.streamgraph-panel {
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
  z-index: 10;
  pointer-events: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
}

.panel-header .sub {
  font-weight: 400;
  color: var(--muted);
  margin-left: 8px;
}

.title-with-legend {
  display: flex;
  align-items: center;
  gap: 24px;
}

.legend {
  display: flex;
  gap: 12px;
  pointer-events: auto;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
}

.legend-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-label {
  color: var(--muted);
}

.legend-label.is-active {
  color: var(--ink);
  font-weight: 600;
}

.svg-container {
  flex: 1;
  min-height: 0;
  padding-top: 36px; /* Space for absolute header */
  background: var(--surface-soft);
}

.streamgraph-svg {
  width: 100%;
  height: 100%;
  display: block;
}

:deep(.stream-brush .selection) {
  fill: rgba(0, 0, 0, 0.1);
  stroke: rgba(0, 0, 0, 0.4);
  stroke-width: 1.5;
}

:deep(.stream-brush .handle) {
  fill: #fff;
  stroke: #333;
}
</style>
