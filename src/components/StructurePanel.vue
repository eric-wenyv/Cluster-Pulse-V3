<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTooltip } from '../composables/useTooltip';
import { renderDomainBars, renderScatter } from '../core/draw/structure';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();
const tooltip = useTooltip();

const containerRef = ref<HTMLElement | null>(null);
const scatterSvgRef = ref<SVGSVGElement | null>(null);
const domainSvgRef = ref<SVGSVGElement | null>(null);

const scatterCaption = ref('');

const hasDomainScope = computed(() => Boolean(store.activeDomainId));

function clearDomain(): void {
  store.setActiveDomain(null);
}

function redrawScatter(): void {
  const svg = scatterSvgRef.value;
  if (!svg) {
    return;
  }
  scatterCaption.value = renderScatter(
    svg,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    store.windowMachineStats,
    {
      showTooltip: (x, y, html) => tooltip.show(x, y, html),
      hideTooltip: () => tooltip.hide(),
      onSelectMachine: (index) => store.setSelectedMachine(index)
    }
  );
}

function redrawDomain(): void {
  const data = store.data;
  const svg = domainSvgRef.value;
  if (!data || !svg) {
    return;
  }
  renderDomainBars(
    svg,
    data,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    store.windowMachineStats,
    {
      showTooltip: (x, y, html) => tooltip.show(x, y, html),
      hideTooltip: () => tooltip.hide(),
      onToggleDomain: (domainId) => store.toggleDomain(domainId)
    }
  );
}

function redrawAll(): void {
  redrawScatter();
  redrawDomain();
}

let resizeObserver: ResizeObserver | null = null;

watch(
  () => [store.metricId, store.windowMachineStats, store.activeDomainId, store.selectedMachineIndex] as const,
  () => {
    redrawAll();
  },
  { flush: 'post' }
);

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => redrawAll());
    resizeObserver.observe(containerRef.value);
  }
  redrawAll();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <section ref="containerRef" class="panel structure-panel">
    <div class="sub-panel">
      <div class="sub-header">
        <div>
          <span class="label">机器</span>
          <strong>CPU 与内存均值</strong>
        </div>
        <span class="caption">{{ scatterCaption }}</span>
      </div>
      <svg ref="scatterSvgRef" class="chart-svg scatter-svg" />
    </div>
    <div class="sub-panel">
      <div class="sub-header">
        <div>
          <span class="label">故障域</span>
          <strong>热点集中度</strong>
        </div>
        <button
          class="domain-clear"
          type="button"
          :disabled="!hasDomainScope"
          @click="clearDomain"
        >
          清除故障域过滤
        </button>
      </div>
      <svg ref="domainSvgRef" class="chart-svg domain-svg" />
    </div>
  </section>
</template>

<style scoped>
.structure-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  padding: 12px;
  min-width: 0;
  min-height: 0;
}

.sub-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 6px;
  min-width: 0;
  min-height: 0;
}

.sub-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.sub-header .label {
  display: block;
  margin-bottom: 2px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sub-header strong {
  font-size: 0.98rem;
}

.sub-header .caption {
  color: var(--muted);
  font-size: 0.78rem;
}

.chart-svg {
  width: 100%;
  height: 100%;
  display: block;
  min-height: 0;
}

.domain-clear {
  min-height: 28px;
  padding: 0 10px;
  font-size: 0.8rem;
}
</style>
