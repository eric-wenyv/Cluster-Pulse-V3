<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTooltip } from '../composables/useTooltip';
import { METRIC_META } from '../core/constants';
import {
  buildPalette,
  drawHeatmapBase,
  drawHeatmapOverlay,
  locateHeatmapCell,
  renderBrushChart
} from '../core/draw/heatmap';
import type { MetricId } from '../core/types';
import { formatPercent, formatWindow, gridValue } from '../core/utils';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();
const tooltip = useTooltip();

const stackRef = ref<HTMLDivElement | null>(null);
const baseCanvasRef = ref<HTMLCanvasElement | null>(null);
const overlayCanvasRef = ref<HTMLCanvasElement | null>(null);
const brushSvgRef = ref<SVGSVGElement | null>(null);
const legendGradientRef = ref<HTMLDivElement | null>(null);

const hoverMachineIndex = ref<number | null>(null);
const heatmapDragStart = ref<{ clientX: number; clientY: number; binIndex: number; rowIndex: number; machineIndex: number } | null>(null);
const heatmapDragCurrent = ref<{ binIndex: number; rowIndex: number; machineIndex: number } | null>(null);
const heatmapDragging = ref(false);
let overlayFrame = 0;
const brushSuppressedRef = { value: false };

const heatmapBaseCache = new Map<string, HTMLCanvasElement>();
const paletteCache = new Map<MetricId, Array<[number, number, number, number]>>();

function getPalette(metricId: MetricId): Array<[number, number, number, number]> {
  const cached = paletteCache.get(metricId);
  if (cached) {
    return cached;
  }
  const palette = buildPalette(metricId);
  paletteCache.set(metricId, palette);
  return palette;
}

const isLoading = computed(() => !store.grid);

const headerTitle = computed(() => {
  if (!store.grid) {
    return '正在加载热力图数据…';
  }
  return `${METRIC_META[store.metricId].label} 热力图`;
});

const headerSubtitle = computed(() => {
  const data = store.data;
  if (!data || !store.grid) {
    return '';
  }
  return `${store.filteredMachineIndices.length}/${store.visibleMachineIndices.length} 台机器 · ${formatWindow(
    store.timeWindow,
    data.manifest.binSeconds
  )}`;
});

const windowCopy = computed(() => {
  const data = store.data;
  if (!data) {
    return '';
  }
  if (!store.grid) {
    return '当前窗口说明：首次进入主图时延迟加载二进制矩阵，以保证 GitHub Pages 首屏体积可控。';
  }
  const top = store.windowMachineStats[0];
  if (!top) {
    return '当前窗口内没有可用机器。';
  }
  return `当前窗口：FD-${top.domainId} 的 ${top.machine.machineId} 在 ${METRIC_META[store.metricId].label} 指标上最突出，峰值 ${formatPercent(
    top.peaks[store.metricId]
  )}，窗口均值 ${formatPercent(top.averages[store.metricId])}。`;
});

const legendStyle = computed(() => ({
  background: `linear-gradient(90deg, ${Array.from({ length: 12 }, (_, index) => METRIC_META[store.metricId].interpolator(index / 11)).join(', ')})`
}));

const heatmapFilterActive = computed(() => store.hasActiveHeatmapFilter);

function clearHeatmapFilter(): void {
  store.clearHeatmapFilter();
}

function fitCanvasToContainer(canvas: HTMLCanvasElement | null, container: HTMLElement | null): boolean {
  if (!canvas || !container) {
    return false;
  }
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.max(1, Math.floor(rect.width * dpr));
  const targetH = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width === targetW && canvas.height === targetH) {
    return false;
  }
  canvas.width = targetW;
  canvas.height = targetH;
  return true;
}

function ensureCanvasSizes(): boolean {
  const a = fitCanvasToContainer(baseCanvasRef.value, stackRef.value);
  const b = fitCanvasToContainer(overlayCanvasRef.value, stackRef.value);
  return a || b;
}

function redrawBase(): void {
  const data = store.data;
  const grid = store.grid;
  const canvas = baseCanvasRef.value;
  if (!data || !grid || !canvas) {
    return;
  }
  drawHeatmapBase(canvas, data, grid, store.metricId, store.activeDomainId, store.visibleMachineIndices, heatmapBaseCache, getPalette);
}

function redrawOverlay(): void {
  const data = store.data;
  const canvas = overlayCanvasRef.value;
  if (!data || !canvas) {
    return;
  }
  drawHeatmapOverlay(
    canvas,
    data,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    store.visibleMachineIndices,
    store.filteredMachineIndices,
    hoverMachineIndex.value,
    heatmapDragging.value,
    heatmapDragStart.value,
    heatmapDragCurrent.value
  );
}

function requestOverlayDraw(): void {
  if (overlayFrame) {
    return;
  }
  overlayFrame = window.requestAnimationFrame(() => {
    overlayFrame = 0;
    redrawOverlay();
  });
}

function redrawBrush(): void {
  const data = store.data;
  const svgNode = brushSvgRef.value;
  if (!data || !svgNode) {
    return;
  }
  renderBrushChart(
    svgNode,
    data,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    (value) => {
      brushSuppressedRef.value = value;
    },
    brushSuppressedRef,
    (window) => {
      store.setTimeWindow(window);
    }
  );
}

function locateCell(event: MouseEvent) {
  const data = store.data;
  if (!data) {
    return null;
  }
  return locateHeatmapCell(overlayCanvasRef.value, event, store.visibleMachineIndices, data.manifest.binCount);
}

function resetDrag(): void {
  heatmapDragStart.value = null;
  heatmapDragCurrent.value = null;
  heatmapDragging.value = false;
  hoverMachineIndex.value = null;
  tooltip.hide();
  requestOverlayDraw();
}

function onPointerDown(event: PointerEvent): void {
  if (!store.grid || event.button !== 0) {
    return;
  }
  const hovered = locateCell(event);
  if (!hovered) {
    return;
  }
  heatmapDragStart.value = {
    clientX: event.clientX,
    clientY: event.clientY,
    binIndex: hovered.binIndex,
    rowIndex: hovered.rowIndex,
    machineIndex: hovered.machineIndex
  };
  heatmapDragCurrent.value = hovered;
  heatmapDragging.value = false;
  hoverMachineIndex.value = hovered.machineIndex;
  tooltip.hide();
  overlayCanvasRef.value?.setPointerCapture(event.pointerId);
  requestOverlayDraw();
}

function onPointerMove(event: PointerEvent): void {
  const grid = store.grid;
  const data = store.data;
  if (!grid || !data) {
    return;
  }
  const hovered = locateCell(event);
  if (heatmapDragStart.value) {
    if (!hovered) {
      return;
    }
    hoverMachineIndex.value = hovered.machineIndex;
    heatmapDragCurrent.value = hovered;
    const start = heatmapDragStart.value;
    const movedEnough = Math.abs(event.clientX - start.clientX) >= 4 || Math.abs(event.clientY - start.clientY) >= 4;
    if (movedEnough) {
      heatmapDragging.value = true;
    }
    tooltip.hide();
    requestOverlayDraw();
    return;
  }
  if (!hovered) {
    if (hoverMachineIndex.value !== null) {
      hoverMachineIndex.value = null;
      requestOverlayDraw();
    }
    tooltip.hide();
    return;
  }
  hoverMachineIndex.value = hovered.machineIndex;
  const machine = data.machines.machines[hovered.machineIndex];
  const value = gridValue(grid, store.metricId, hovered.binIndex, hovered.machineIndex);
  requestOverlayDraw();
  if (value === null) {
    tooltip.hide();
    return;
  }
  tooltip.show(
    event.clientX,
    event.clientY,
    `<strong>${machine.machineId}</strong><br />FD-${machine.failureDomain1} · ${formatWindow(
      [hovered.binIndex, hovered.binIndex],
      data.manifest.binSeconds
    )}<br />${METRIC_META[store.metricId].label}: ${formatPercent(value)}`
  );
}

function onPointerLeave(): void {
  if (heatmapDragStart.value) {
    return;
  }
  hoverMachineIndex.value = null;
  tooltip.hide();
  requestOverlayDraw();
}

function commitBrush(
  started: { binIndex: number; rowIndex: number; machineIndex: number },
  ended: { binIndex: number; rowIndex: number; machineIndex: number }
): void {
  const data = store.data;
  if (!data) {
    return;
  }
  const visible = store.visibleMachineIndices;
  if (!visible.length) {
    return;
  }
  const startRow = Math.max(0, Math.min(started.rowIndex, ended.rowIndex));
  const endRow = Math.min(visible.length - 1, Math.max(started.rowIndex, ended.rowIndex));
  const startBin = Math.max(0, Math.min(started.binIndex, ended.binIndex));
  const endBin = Math.min(data.manifest.binCount - 1, Math.max(started.binIndex, ended.binIndex));
  const selected = visible.slice(startRow, endRow + 1);
  const machineIndices = selected.length === 0 || selected.length === visible.length ? [] : selected;
  store.applyHeatmapBrush({
    timeWindow: [startBin, endBin],
    machineIndices,
    selectedMachine: selected[0] ?? ended.machineIndex
  });
}

function onPointerUp(event: PointerEvent): void {
  const overlay = overlayCanvasRef.value;
  if (!store.grid || !heatmapDragStart.value || !overlay) {
    return;
  }
  const started = heatmapDragStart.value;
  const hovered = locateCell(event) ?? heatmapDragCurrent.value;
  if (overlay.hasPointerCapture(event.pointerId)) {
    overlay.releasePointerCapture(event.pointerId);
  }
  heatmapDragStart.value = null;
  heatmapDragCurrent.value = null;
  const wasDragging = heatmapDragging.value;
  heatmapDragging.value = false;
  tooltip.hide();
  if (!hovered) {
    hoverMachineIndex.value = null;
    requestOverlayDraw();
    return;
  }
  if (!wasDragging) {
    store.setSelectedMachine(hovered.machineIndex);
    return;
  }
  commitBrush(started, hovered);
}

function onPointerCancel(): void {
  resetDrag();
}

function onResize(): void {
  if (ensureCanvasSizes()) {
    heatmapBaseCache.clear();
    redrawBase();
    redrawOverlay();
    redrawBrush();
  }
}

let resizeObserver: ResizeObserver | null = null;

watch(
  () => [store.metricId, store.activeDomainId, store.visibleMachineIndices, store.grid] as const,
  () => {
    redrawBase();
    requestOverlayDraw();
  },
  { flush: 'post' }
);

watch(
  () => [
    store.timeWindow[0],
    store.timeWindow[1],
    store.selectedMachineIndex,
    store.filteredMachineIndices,
    store.machineFilterIndices
  ] as const,
  () => {
    requestOverlayDraw();
  },
  { flush: 'post' }
);

watch(
  () => [store.metricId, store.timeWindow[0], store.timeWindow[1], store.data] as const,
  () => {
    redrawBrush();
  },
  { flush: 'post' }
);

onMounted(async () => {
  if (stackRef.value) {
    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(stackRef.value);
  }
  ensureCanvasSizes();
  await store.ensureGrid();
  redrawBase();
  requestOverlayDraw();
  redrawBrush();
});

onBeforeUnmount(() => {
  if (overlayFrame) {
    window.cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <section class="panel heatmap-panel">
    <div class="panel-header">
      <div class="panel-header-copy">
        <span class="label">资源热点</span>
        <strong>{{ headerTitle }}</strong>
        <span v-if="headerSubtitle" class="header-meta">{{ headerSubtitle }}</span>
      </div>
      <div class="panel-header-actions">
        <button class="domain-clear" type="button" :disabled="!heatmapFilterActive" @click="clearHeatmapFilter">
          清除主图筛选
        </button>
      </div>
    </div>
    <p class="window-copy">{{ windowCopy }}</p>
    <div ref="stackRef" class="heatmap-stack">
      <canvas ref="baseCanvasRef" />
      <canvas
        ref="overlayCanvasRef"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      />
      <div v-if="isLoading" class="heatmap-loading">正在加载热力图数据…</div>
    </div>
    <div class="brush-wrap">
      <svg ref="brushSvgRef" />
    </div>
    <div class="legend-row">
      <div class="legend-block">
        <div ref="legendGradientRef" class="legend-gradient" :style="legendStyle" />
        <div class="legend-labels"><span>0%</span><span>50%</span><span>100%</span></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.heatmap-panel {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  gap: 10px;
  height: 100%;
  padding: 14px;
  min-width: 0;
  min-height: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.panel-header-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.panel-header-copy .label {
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.panel-header-copy strong {
  font-size: 1.05rem;
}

.header-meta {
  color: var(--muted);
  font-size: 0.86rem;
}

.window-copy {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.heatmap-stack {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  background: #eef2f7;
}

.heatmap-stack canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.heatmap-stack canvas:first-child {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.heatmap-stack canvas:nth-child(2) {
  cursor: crosshair;
  touch-action: none;
}

.heatmap-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--muted);
  background: rgba(243, 245, 247, 0.85);
  pointer-events: none;
}

.brush-wrap svg {
  width: 100%;
  height: 72px;
  display: block;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.legend-block {
  flex: 1;
  min-width: 0;
}

.legend-gradient {
  width: min(420px, 100%);
  height: 8px;
  border-radius: 999px;
  border: 1px solid var(--line);
}

.legend-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  width: min(420px, 100%);
  color: var(--muted);
  font-size: 0.75rem;
}
</style>
