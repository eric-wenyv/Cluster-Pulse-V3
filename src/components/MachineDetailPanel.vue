<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTooltip } from '../composables/useTooltip';
import { renderMachineDetail } from '../core/draw/machine-detail';
import { METRIC_META } from '../core/constants';
import type { MachineRecord } from '../core/types';
import { formatTime, gridValue } from '../core/utils';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();
const tooltip = useTooltip();

const containerRef = ref<HTMLElement | null>(null);
const chartWrapperRef = ref<HTMLDivElement | null>(null);
const cursorLineRef = ref<HTMLDivElement | null>(null);

const activeMachine = computed<MachineRecord | null>(() => {
  const data = store.data;
  if (!data) {
    return null;
  }
  const candidate = store.selectedMachineIndex;
  if (candidate !== null) {
    const direct = data.machines.machines.find((machine) => machine.index === candidate);
    if (direct) {
      return direct;
    }
  }
  const fallbackIndex = store.windowMachineStats[0]?.machineIndex ?? null;
  if (fallbackIndex !== null) {
    return data.machines.machines.find((machine) => machine.index === fallbackIndex) ?? null;
  }
  return data.machines.machines[0] ?? null;
});

const title = computed(() => {
  const machine = activeMachine.value;
  if (!machine) {
    return '等待加载';
  }
  return `${machine.machineId} · FD-${machine.failureDomain1}`;
});

const subtitle = computed(() => {
  const machine = activeMachine.value;
  if (!machine) {
    return '';
  }
  return `CPU ${machine.cpuNum} 核 · 内存 ${machine.memSize} 归一化单位 · 状态 ${machine.status}`;
});

function redraw(): void {
  const data = store.data;
  const grid = store.grid;
  const container = chartWrapperRef.value;
  const machine = activeMachine.value;
  if (!data || !grid || !container || !machine) {
    if (container && (!data || !grid || !machine)) {
      container.innerHTML = '';
    }
    return;
  }
  renderMachineDetail(
    container,
    data,
    grid,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    machine
  );
}

function onMouseMove(event: MouseEvent): void {
  const data = store.data;
  const grid = store.grid;
  const machine = activeMachine.value;
  const wrapper = chartWrapperRef.value;
  const cursor = cursorLineRef.value;
  if (!data || !grid || !machine || !wrapper || !cursor) {
    return;
  }

  const rect = wrapper.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const plotLeft = 32; // leftPad from drawHorizonChart
  const plotRight = 8; // rightPad
  const plotWidth = rect.width - plotLeft - plotRight;

  if (x < plotLeft || x > rect.width - plotRight) {
    cursor.style.opacity = '0';
    tooltip.hide();
    return;
  }

  const [winStart, winEnd] = store.timeWindow;
  const visibleBinCount = winEnd - winStart + 1;
  if (visibleBinCount <= 0) {
    return;
  }

  const relativeX = (x - plotLeft) / plotWidth;
  const binOffset = Math.max(0, Math.min(visibleBinCount - 1, Math.round(relativeX * (visibleBinCount - 1))));
  const binIndex = winStart + binOffset;

  // Position cursor line
  const lineX = plotLeft + (binOffset / Math.max(1, visibleBinCount - 1)) * plotWidth;
  cursor.style.left = `${lineX}px`;
  cursor.style.opacity = '1';

  // Build tooltip content
  const timeStr = formatTime(binIndex * data.manifest.binSeconds);
  const metricsHtml = (['cpu', 'memory', 'network', 'disk'] as const)
    .map((m) => {
      const val = gridValue(grid, m, binIndex, machine.index);
      const meta = METRIC_META[m];
      return val !== null
        ? `<span style="color:${meta.accent}">${meta.label}</span>: ${val}%`
        : `<span style="color:${meta.accent}">${meta.label}</span>: —`;
    })
    .join('<br/>');

  tooltip.show(
    event.clientX,
    event.clientY,
    `<strong>${machine.machineId}</strong><br/>` +
    `<span style="color:var(--muted)">${timeStr}</span><br/>` +
    `${metricsHtml}`
  );
}

function onMouseLeave(): void {
  if (cursorLineRef.value) {
    cursorLineRef.value.style.opacity = '0';
  }
  tooltip.hide();
}

let resizeObserver: ResizeObserver | null = null;

watch(
  () => [activeMachine.value?.index, store.metricId, store.timeWindow[0], store.timeWindow[1], store.grid] as const,
  () => {
    redraw();
  },
  { flush: 'post' }
);

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => redraw());
    resizeObserver.observe(containerRef.value);
  }
  redraw();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <section ref="containerRef" class="panel detail-panel">
    <div class="detail-header">
      <div>
        <span class="label">选中机器</span>
        <strong>{{ title }}</strong>
      </div>
      <span class="subtitle">{{ subtitle }}</span>
    </div>
    <div class="horizon-wrapper" @mousemove="onMouseMove" @mouseleave="onMouseLeave">
      <div ref="chartWrapperRef" class="chart-area" />
      <div ref="cursorLineRef" class="cursor-line" />
    </div>
  </section>
</template>

<style scoped>
.detail-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  height: 100%;
  padding: 12px;
  min-width: 0;
  min-height: 0;
}

.detail-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-header .label {
  display: block;
  margin-bottom: 2px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.detail-header strong {
  font-size: 1rem;
}

.detail-header .subtitle {
  color: var(--muted);
  font-size: 0.82rem;
}

.horizon-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
}

.chart-area {
  position: absolute;
  inset: 0;
}

.cursor-line {
  position: absolute;
  top: 8px;
  bottom: 28px;
  width: 0;
  border-left: 1px dashed var(--ink);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s;
  z-index: 5;
}
</style>
