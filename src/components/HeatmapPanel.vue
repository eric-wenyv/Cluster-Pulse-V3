<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTooltip } from '../composables/useTooltip';
import { METRIC_META } from '../core/constants';
import {
  buildPalette,
  drawContainerHatching,
  drawHeatmapDetail,
  drawHeatmapOverlay,
  drawMinimap,
  drawMinimapBrush,
  locateHeatmapCell
} from '../core/draw/heatmap';
import type { MetricId } from '../core/types';
import { formatPercent, formatWindow, gridValue } from '../core/utils';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();
const tooltip = useTooltip();

const stackRef = ref<HTMLDivElement | null>(null);
const detailBaseRef = ref<HTMLCanvasElement | null>(null);
const detailHatchRef = ref<HTMLCanvasElement | null>(null);
const detailOverlayRef = ref<HTMLCanvasElement | null>(null);
const minimapStackRef = ref<HTMLDivElement | null>(null);
const minimapBaseRef = ref<HTMLCanvasElement | null>(null);
const minimapHatchRef = ref<HTMLCanvasElement | null>(null);
const minimapOverlayRef = ref<HTMLCanvasElement | null>(null);
const legendGradientRef = ref<HTMLDivElement | null>(null);

const hoverMachineIndex = ref<number | null>(null);
const heatmapDragStart = ref<{ clientX: number; clientY: number; binIndex: number; rowIndex: number; machineIndex: number } | null>(null);
const heatmapDragCurrent = ref<{ binIndex: number; rowIndex: number; machineIndex: number } | null>(null);
const heatmapDragging = ref(false);
const ctrlHoverOnSelection = ref(false);
let overlayFrame = 0;

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
  let changed = false;
  changed = fitCanvasToContainer(detailBaseRef.value, stackRef.value) || changed;
  changed = fitCanvasToContainer(detailHatchRef.value, stackRef.value) || changed;
  changed = fitCanvasToContainer(detailOverlayRef.value, stackRef.value) || changed;
  changed = fitCanvasToContainer(minimapBaseRef.value, minimapStackRef.value) || changed;
  changed = fitCanvasToContainer(minimapHatchRef.value, minimapStackRef.value) || changed;
  changed = fitCanvasToContainer(minimapOverlayRef.value, minimapStackRef.value) || changed;
  return changed;
}

function redrawDetail(): void {
  const data = store.data;
  const grid = store.grid;
  const canvas = detailBaseRef.value;
  if (!data || !grid || !canvas) {
    return;
  }
  drawHeatmapDetail(
    canvas,
    data,
    grid,
    store.metricId,
    store.activeDomainId,
    store.machineFilterKey,
    store.filteredMachineIndices,
    store.timeWindow,
    heatmapBaseCache,
    getPalette
  );
}

function redrawMinimap(): void {
  const data = store.data;
  const grid = store.grid;
  const canvas = minimapBaseRef.value;
  if (!data || !grid || !canvas) {
    return;
  }
  drawMinimap(
    canvas,
    data,
    grid,
    store.metricId,
    store.activeDomainId,
    store.machineFilterKey,
    store.filteredMachineIndices,
    heatmapBaseCache,
    getPalette
  );
}

function redrawDetailOverlay(): void {
  const data = store.data;
  const canvas = detailOverlayRef.value;
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
    store.filteredMachineIndices,
    hoverMachineIndex.value,
    heatmapDragging.value,
    heatmapDragStart.value,
    heatmapDragCurrent.value,
    store.timeWindow,
    ctrlHoverOnSelection.value,
    store.brushTimeWindow,
    store.brushMachineIndices
  );
}

function redrawMinimapBrush(): void {
  const data = store.data;
  const canvas = minimapOverlayRef.value;
  if (!data || !canvas) {
    return;
  }
  drawMinimapBrush(canvas, store.timeWindow, data.manifest.binCount, store.filteredMachineIndices, store.brushMachineIndices, store.brushTimeWindow);
}

function redrawDetailHatching(): void {
  const canvas = detailHatchRef.value;
  const containerGrid = store.containerGrid;
  if (!canvas) {
    return;
  }
  if (!containerGrid || !store.showContainerOverlay) {
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawContainerHatching(canvas, containerGrid, store.filteredMachineIndices, store.timeWindow, null);
}

function redrawMinimapHatching(): void {
  const canvas = minimapHatchRef.value;
  const containerGrid = store.containerGrid;
  if (!canvas) {
    return;
  }
  if (!containerGrid || !store.showContainerOverlay) {
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawContainerHatching(canvas, containerGrid, store.filteredMachineIndices, null, null);
}

function requestDetailOverlayDraw(): void {
  if (overlayFrame) {
    return;
  }
  overlayFrame = window.requestAnimationFrame(() => {
    overlayFrame = 0;
    redrawDetailOverlay();
  });
}

function locateDetailCell(event: MouseEvent) {
  const data = store.data;
  if (!data) {
    return null;
  }
  return locateHeatmapCell(
    detailOverlayRef.value,
    event,
    store.filteredMachineIndices,
    data.manifest.binCount,
    store.timeWindow
  );
}

function isInsideBrushTimeWindow(event: MouseEvent): boolean {
  const cell = locateDetailCell(event);
  if (!cell || !store.brushTimeWindow) {
    return false;
  }
  return cell.binIndex >= store.brushTimeWindow[0] && cell.binIndex <= store.brushTimeWindow[1];
}

function updateDetailCursor(event: PointerEvent): void {
  const canvas = detailOverlayRef.value;
  if (!canvas) {
    return;
  }
  if (!heatmapDragging.value && event.ctrlKey && isInsideBrushTimeWindow(event)) {
    canvas.style.cursor = 'pointer';
    if (!ctrlHoverOnSelection.value) {
      ctrlHoverOnSelection.value = true;
      requestDetailOverlayDraw();
    }
  } else {
    canvas.style.cursor = 'crosshair';
    if (ctrlHoverOnSelection.value) {
      ctrlHoverOnSelection.value = false;
      requestDetailOverlayDraw();
    }
  }
}

function resetDrag(): void {
  heatmapDragStart.value = null;
  heatmapDragCurrent.value = null;
  heatmapDragging.value = false;
  hoverMachineIndex.value = null;
  tooltip.hide();
  requestDetailOverlayDraw();
}

function onPointerDown(event: PointerEvent): void {
  if (!store.grid || event.button !== 0) {
    return;
  }
  const hovered = locateDetailCell(event);
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
  detailOverlayRef.value?.setPointerCapture(event.pointerId);
  requestDetailOverlayDraw();
}

function onPointerMove(event: PointerEvent): void {
  const grid = store.grid;
  const data = store.data;
  if (!grid || !data) {
    return;
  }

  updateDetailCursor(event);

  const hovered = locateDetailCell(event);
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
    requestDetailOverlayDraw();
    return;
  }
  if (!hovered) {
    if (hoverMachineIndex.value !== null) {
      hoverMachineIndex.value = null;
      requestDetailOverlayDraw();
    }
    tooltip.hide();
    return;
  }
  hoverMachineIndex.value = hovered.machineIndex;
  const machine = data.machines.machines[hovered.machineIndex];
  const value = gridValue(grid, store.metricId, hovered.binIndex, hovered.machineIndex);
  requestDetailOverlayDraw();
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
  ctrlHoverOnSelection.value = false;
  const canvas = detailOverlayRef.value;
  if (canvas) {
    canvas.style.cursor = 'crosshair';
  }
  tooltip.hide();
  requestDetailOverlayDraw();
}

function commitBrush(
  started: { binIndex: number; rowIndex: number; machineIndex: number },
  ended: { binIndex: number; rowIndex: number; machineIndex: number }
): void {
  const data = store.data;
  if (!data) {
    return;
  }
  const displayIndices = store.filteredMachineIndices;
  if (!displayIndices.length) {
    return;
  }
  const startRow = Math.max(0, Math.min(started.rowIndex, ended.rowIndex));
  const endRow = Math.min(displayIndices.length - 1, Math.max(started.rowIndex, ended.rowIndex));
  const startBin = Math.max(0, Math.min(started.binIndex, ended.binIndex));
  const endBin = Math.min(data.manifest.binCount - 1, Math.max(started.binIndex, ended.binIndex));
  const selected = displayIndices.slice(startRow, endRow + 1);
  const machineIndices = selected.length === 0 || selected.length === displayIndices.length ? [] : selected;
  store.brushMachineIndices = machineIndices.length ? machineIndices : null;
  store.brushTimeWindow = [startBin, endBin];
  store.setSelectedMachine(selected[0] ?? ended.machineIndex);
}

function onPointerUp(event: PointerEvent): void {
  const overlay = detailOverlayRef.value;
  if (!store.grid || !heatmapDragStart.value || !overlay) {
    return;
  }
  const started = heatmapDragStart.value;
  const hovered = locateDetailCell(event) ?? heatmapDragCurrent.value;
  if (overlay.hasPointerCapture(event.pointerId)) {
    overlay.releasePointerCapture(event.pointerId);
  }
  heatmapDragStart.value = null;
  heatmapDragCurrent.value = null;
  const wasDragging = heatmapDragging.value;
  heatmapDragging.value = false;
  tooltip.hide();

  if (!wasDragging && event.ctrlKey && isInsideBrushTimeWindow(event)) {
    const bw = store.brushTimeWindow;
    if (bw) {
      const bm = store.brushMachineIndices;
      if (bm && bm.length) {
        store.zoomTo(bw, bm);
      } else {
        store.zoomTo(bw);
      }
      store.brushMachineIndices = null;
    }
    updateDetailCursor(event);
    return;
  }

  if (!hovered) {
    hoverMachineIndex.value = null;
    requestDetailOverlayDraw();
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

type MinimapBrushMode = 'pan' | 'resize-left' | 'resize-right' | 'create';

const minimapBrushDrag = ref<{
  mode: MinimapBrushMode;
  startX: number;
  startWindow: [number, number];
} | null>(null);

function getMinimapBrushMode(event: PointerEvent): MinimapBrushMode {
  const data = store.data;
  const canvas = minimapOverlayRef.value;
  if (!data || !canvas) {
    return 'pan';
  }
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const leftPx = (store.timeWindow[0] / data.manifest.binCount) * rect.width;
  const rightPx = ((store.timeWindow[1] + 1) / data.manifest.binCount) * rect.width;
  const edgeThreshold = 6;

  if (Math.abs(x - leftPx) < edgeThreshold) {
    return 'resize-left';
  }
  if (Math.abs(x - rightPx) < edgeThreshold) {
    return 'resize-right';
  }
  if (x > leftPx && x < rightPx) {
    return 'pan';
  }
  return 'create';
}

function onMinimapPointerDown(event: PointerEvent): void {
  if (!store.data || event.button !== 0) {
    return;
  }
  const canvas = minimapOverlayRef.value;
  if (!canvas) {
    return;
  }
  const mode = getMinimapBrushMode(event);

  if (mode === 'create') {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const bin = Math.floor((x / rect.width) * store.data.manifest.binCount);
    const windowSize = store.timeWindow[1] - store.timeWindow[0];
    let newStart = bin - Math.floor(windowSize / 2);
    let newEnd = newStart + windowSize;
    if (newStart < 0) {
      newStart = 0;
      newEnd = windowSize;
    }
    if (newEnd >= store.data.manifest.binCount) {
      newEnd = store.data.manifest.binCount - 1;
      newStart = newEnd - windowSize;
    }
    store.setTimeWindow([newStart, newEnd]);
    minimapBrushDrag.value = {
      mode: 'pan',
      startX: event.clientX,
      startWindow: [newStart, newEnd]
    };
  } else {
    minimapBrushDrag.value = {
      mode,
      startX: event.clientX,
      startWindow: [...store.timeWindow]
    };
  }
  canvas.setPointerCapture(event.pointerId);
}

function onMinimapPointerMove(event: PointerEvent): void {
  if (!minimapBrushDrag.value || !store.data) {
    return;
  }
  const canvas = minimapOverlayRef.value;
  if (!canvas) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const deltaBins = Math.round(
    ((event.clientX - minimapBrushDrag.value.startX) / rect.width) * store.data.manifest.binCount
  );
  const startWindow = minimapBrushDrag.value.startWindow;
  const mode = minimapBrushDrag.value.mode;
  const binCount = store.data.manifest.binCount;

  let newStart = startWindow[0];
  let newEnd = startWindow[1];

  if (mode === 'pan') {
    newStart = startWindow[0] + deltaBins;
    newEnd = startWindow[1] + deltaBins;
    if (newStart < 0) {
      newStart = 0;
      newEnd = startWindow[1] - startWindow[0];
    }
    if (newEnd >= binCount) {
      newEnd = binCount - 1;
      newStart = newEnd - (startWindow[1] - startWindow[0]);
    }
  } else if (mode === 'resize-left') {
    newStart = startWindow[0] + deltaBins;
    newStart = Math.max(0, Math.min(newStart, startWindow[1] - 1));
  } else if (mode === 'resize-right') {
    newEnd = startWindow[1] + deltaBins;
    newEnd = Math.max(startWindow[0] + 1, Math.min(newEnd, binCount - 1));
  }

  store.setTimeWindow([newStart, newEnd]);
}

function onMinimapPointerUp(event: PointerEvent): void {
  const canvas = minimapOverlayRef.value;
  if (canvas && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  minimapBrushDrag.value = null;
}

function onMinimapPointerLeave(): void {
  minimapBrushDrag.value = null;
}

function onResize(): void {
  if (ensureCanvasSizes()) {
    heatmapBaseCache.clear();
    redrawDetail();
    redrawMinimap();
    redrawDetailHatching();
    redrawMinimapHatching();
    requestDetailOverlayDraw();
    redrawMinimapBrush();
  }
}

let resizeObserver: ResizeObserver | null = null;

watch(
  () => [store.metricId, store.activeDomainId, store.visibleMachineIndices, store.grid, store.machineFilterKey] as const,
  () => {
    redrawDetail();
    redrawMinimap();
    redrawDetailHatching();
    redrawMinimapHatching();
    requestDetailOverlayDraw();
    redrawMinimapBrush();
  },
  { flush: 'post' }
);

watch(
  () => [
    store.timeWindow[0],
    store.timeWindow[1],
    store.selectedMachineIndex,
    store.filteredMachineIndices,
    store.machineFilterIndices,
    store.brushMachineIndices
  ] as const,
  () => {
    redrawDetail();
    redrawMinimapBrush();
    redrawDetailHatching();
    requestDetailOverlayDraw();
  },
  { flush: 'post' }
);

watch(
  () => store.showContainerOverlay,
  () => {
    redrawDetailHatching();
    redrawMinimapHatching();
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
  redrawDetail();
  redrawMinimap();
  redrawDetailHatching();
  redrawMinimapHatching();
  requestDetailOverlayDraw();
  redrawMinimapBrush();
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
        <button
          v-if="store.zoomStack.length > 0"
          class="zoom-back-button"
          type="button"
          @click="store.zoomBack"
        >
          返回上一层 ({{ store.zoomStack.length }})
        </button>
        <button
          class="metric-button"
          type="button"
          :class="{ 'is-active': store.showContainerOverlay }"
          @click="store.toggleContainerOverlay"
        >
          容器密度
        </button>
        <button class="domain-clear" type="button" :disabled="!heatmapFilterActive" @click="clearHeatmapFilter">
          清除主图筛选
        </button>
      </div>
    </div>
    <p class="window-copy">{{ windowCopy }}</p>
    <div ref="stackRef" class="heatmap-stack">
      <canvas ref="detailBaseRef" />
      <canvas ref="detailHatchRef" class="hatch-canvas" />
      <canvas
        ref="detailOverlayRef"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      />
      <div ref="minimapStackRef" class="minimap-stack">
        <canvas ref="minimapBaseRef" />
        <canvas ref="minimapHatchRef" class="hatch-canvas" />
        <canvas
          ref="minimapOverlayRef"
          @pointerdown="onMinimapPointerDown"
          @pointermove="onMinimapPointerMove"
          @pointerleave="onMinimapPointerLeave"
          @pointerup="onMinimapPointerUp"
        />
      </div>
      <div v-if="isLoading" class="heatmap-loading">正在加载热力图数据…</div>
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
  grid-template-rows: auto auto minmax(0, 1fr) auto;
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

.heatmap-stack > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.heatmap-stack > canvas:first-child {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.heatmap-stack > canvas:nth-child(3) {
  cursor: crosshair;
  touch-action: none;
}

.hatch-canvas {
  pointer-events: none;
}

.minimap-stack {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 200px;
  height: 120px;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  background: var(--surface);
  z-index: 10;
}

.minimap-stack canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.minimap-stack canvas:first-child {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

.minimap-stack canvas:nth-child(3) {
  cursor: col-resize;
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

.panel-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.zoom-back-button {
  padding: 4px 10px;
  font-size: 0.82rem;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  cursor: pointer;
}

.zoom-back-button:hover {
  background: var(--line);
}
</style>
