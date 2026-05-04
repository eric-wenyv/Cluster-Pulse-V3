import * as d3 from 'd3';
import { CHART_MARGINS, METRIC_META } from '../constants';
import type { AppData, AppState, ContainerGrid, GridData, MetricId } from '../types';
import { formatTime, gridValue } from '../utils';

export type HeatmapSelection = { startBin: number; endBin: number; startRow: number; endRow: number };

export function buildPalette(metricId: MetricId): Array<[number, number, number, number]> {
  return Array.from({ length: 101 }, (_, index) => {
    const color = d3.rgb(METRIC_META[metricId].interpolator(index / 100));
    return [color.r, color.g, color.b, 255];
  });
}

function getOrCreateOffscreenCache(
  data: AppData,
  grid: GridData,
  metricId: MetricId,
  activeDomainId: string | null,
  machineFilterKey: string,
  displayMachineIndices: number[],
  heatmapBaseCache: Map<string, HTMLCanvasElement>,
  getPalette: (metricId: MetricId) => Array<[number, number, number, number]>
): HTMLCanvasElement {
  const srcWidth = data.manifest.binCount;
  const srcHeight = Math.max(displayMachineIndices.length, 1);
  const cacheKey = `${metricId}:${activeDomainId ?? 'all'}:${machineFilterKey}`;
  let offscreen = heatmapBaseCache.get(cacheKey);

  if (!offscreen) {
    offscreen = document.createElement('canvas');
    offscreen.width = srcWidth;
    offscreen.height = srcHeight;
    const offContext = offscreen.getContext('2d');
    if (!offContext) {
      heatmapBaseCache.set(cacheKey, offscreen);
      return offscreen;
    }
    const image = offContext.createImageData(srcWidth, srcHeight);
    const palette = getPalette(metricId);

    displayMachineIndices.forEach((machineIndex, row) => {
      for (let binIndex = 0; binIndex < srcWidth; binIndex += 1) {
        const value = gridValue(grid, metricId, binIndex, machineIndex);
        const pixelIndex = (row * srcWidth + binIndex) * 4;
        const color = value === null ? [235, 238, 242, 255] : palette[value];
        image.data[pixelIndex] = color[0];
        image.data[pixelIndex + 1] = color[1];
        image.data[pixelIndex + 2] = color[2];
        image.data[pixelIndex + 3] = color[3];
      }
    });

    offContext.putImageData(image, 0, 0);
    heatmapBaseCache.set(cacheKey, offscreen);
  }

  return offscreen;
}

export function drawHeatmapDetail(
  canvas: HTMLCanvasElement,
  data: AppData,
  grid: GridData,
  metricId: MetricId,
  activeDomainId: string | null,
  machineFilterKey: string,
  displayMachineIndices: number[],
  timeWindow: [number, number],
  heatmapBaseCache: Map<string, HTMLCanvasElement>,
  getPalette: (metricId: MetricId) => Array<[number, number, number, number]>
): void {
  const offscreen = getOrCreateOffscreenCache(
    data,
    grid,
    metricId,
    activeDomainId,
    machineFilterKey,
    displayMachineIndices,
    heatmapBaseCache,
    getPalette
  );

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sx = timeWindow[0];
  const sw = timeWindow[1] - timeWindow[0] + 1;
  const sh = Math.max(displayMachineIndices.length, 1);
  ctx.drawImage(offscreen, sx, 0, sw, sh, 0, 0, canvas.width, canvas.height);
}

export function drawMinimap(
  canvas: HTMLCanvasElement,
  data: AppData,
  grid: GridData,
  metricId: MetricId,
  activeDomainId: string | null,
  machineFilterKey: string,
  displayMachineIndices: number[],
  heatmapBaseCache: Map<string, HTMLCanvasElement>,
  getPalette: (metricId: MetricId) => Array<[number, number, number, number]>
): void {
  const offscreen = getOrCreateOffscreenCache(
    data,
    grid,
    metricId,
    activeDomainId,
    machineFilterKey,
    displayMachineIndices,
    heatmapBaseCache,
    getPalette
  );

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
}

export function drawMinimapBrush(
  canvas: HTMLCanvasElement,
  timeWindow: [number, number],
  binCount: number,
  displayMachineIndices: number[] = [],
  brushMachineIndices: number[] | null = null,
  brushTimeWindow: [number, number] | null = null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (brushMachineIndices && brushMachineIndices.length > 0 && displayMachineIndices.length > 0 && brushTimeWindow) {
    const rowHeight = canvas.height / Math.max(displayMachineIndices.length, 1);
    const x1 = (brushTimeWindow[0] / binCount) * canvas.width;
    const x2 = ((brushTimeWindow[1] + 1) / binCount) * canvas.width;
    ctx.fillStyle = 'rgba(22, 61, 117, 0.22)';
    for (const machineIndex of brushMachineIndices) {
      const row = displayMachineIndices.indexOf(machineIndex);
      if (row >= 0) {
        ctx.fillRect(x1, row * rowHeight, x2 - x1, rowHeight);
      }
    }
  }

  const x1 = (timeWindow[0] / binCount) * canvas.width;
  const x2 = ((timeWindow[1] + 1) / binCount) * canvas.width;

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(x1, 0, x2 - x1, canvas.height);
  ctx.strokeStyle = 'rgba(22, 61, 117, 0.96)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x1 + 1, 1, Math.max(1, x2 - x1 - 2), canvas.height - 2);
  ctx.restore();
}

let hatchPatternCanvas: HTMLCanvasElement | null = null;

function getHatchPattern(): HTMLCanvasElement {
  if (hatchPatternCanvas) {
    return hatchPatternCanvas;
  }
  const size = 8;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size, 0);
  ctx.stroke();
  hatchPatternCanvas = canvas;
  return canvas;
}

function computeMaxContainers(containerGrid: ContainerGrid): number {
  let max = 0;
  for (let i = 0; i < containerGrid.values.length; i += 1) {
    const v = containerGrid.values[i];
    if (v > max) {
      max = v;
    }
  }
  return Math.max(1, max);
}

export function drawContainerHatching(
  canvas: HTMLCanvasElement,
  containerGrid: ContainerGrid,
  displayMachineIndices: number[],
  binWindow: [number, number] | null,
  maxContainers: number | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const normMax = maxContainers ?? computeMaxContainers(containerGrid);
  const pattern = getHatchPattern();
  const pat = ctx.createPattern(pattern, 'repeat');
  if (!pat) {
    return;
  }

  const startBin = binWindow?.[0] ?? 0;
  const endBin = binWindow?.[1] ?? containerGrid.binCount - 1;
  const visibleBinCount = endBin - startBin + 1;
  const rowCount = Math.max(displayMachineIndices.length, 1);

  const cellW = canvas.width / visibleBinCount;
  const cellH = canvas.height / rowCount;

  ctx.fillStyle = pat;

  for (let row = 0; row < displayMachineIndices.length; row += 1) {
    const machineIndex = displayMachineIndices[row];
    for (let bin = startBin; bin <= endBin; bin += 1) {
      const count = containerGrid.values[machineIndex * containerGrid.binCount + bin];
      if (count === 0) {
        continue;
      }
      const alpha = Math.min(1, count / normMax) * 0.5;
      ctx.globalAlpha = alpha;
      const x = ((bin - startBin) / visibleBinCount) * canvas.width;
      const y = (row / rowCount) * canvas.height;
      ctx.fillRect(x, y, cellW + 0.5, cellH + 0.5);
    }
  }

  ctx.globalAlpha = 1;
}

export function drawHeatmapOverlay(
  canvas: HTMLCanvasElement,
  data: AppData,
  state: AppState,
  displayMachineIndices: number[],
  hoverMachineIndex: number | null,
  heatmapDragging: boolean,
  heatmapDragStart: { binIndex: number; rowIndex: number } | null,
  heatmapDragCurrent: { binIndex: number; rowIndex: number } | null,
  viewportBinWindow: [number, number] | null = null,
  ctrlHoverOnSelection: boolean = false,
  brushTimeWindow: [number, number] | null = null,
  brushMachineIndices: number[] | null = null
): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (heatmapDragging) {
    const draft = getDraftHeatmapSelection(heatmapDragStart, heatmapDragCurrent);
    if (draft) {
      drawHeatmapSelectionMask(
        context,
        canvas,
        draft,
        displayMachineIndices.length,
        data.manifest.binCount,
        viewportBinWindow
      );
    }
  }

  // Ctrl hover highlight on the brush time window
  if (ctrlHoverOnSelection && brushTimeWindow) {
    const vpStart = viewportBinWindow?.[0] ?? 0;
    const vpEnd = viewportBinWindow?.[1] ?? data.manifest.binCount - 1;
    const vpCount = vpEnd - vpStart + 1;

    const x1 = ((brushTimeWindow[0] - vpStart) / vpCount) * canvas.width;
    const x2 = ((brushTimeWindow[1] + 1 - vpStart) / vpCount) * canvas.width;
    const rowHeight = canvas.height / Math.max(displayMachineIndices.length, 1);

    context.save();
    context.fillStyle = 'rgba(255, 255, 255, 0.35)';
    if (brushMachineIndices && brushMachineIndices.length > 0) {
      for (const machineIndex of brushMachineIndices) {
        const row = displayMachineIndices.indexOf(machineIndex);
        if (row >= 0) {
          context.fillRect(x1, row * rowHeight, x2 - x1, rowHeight);
        }
      }
    } else {
      context.fillRect(x1, 0, x2 - x1, canvas.height);
    }
    context.restore();
  }

  if (!heatmapDragging && brushMachineIndices && brushMachineIndices.length > 0 && brushTimeWindow) {
    const rowCount = displayMachineIndices.length;
    const rowHeight = canvas.height / Math.max(rowCount, 1);
    const vpStart = viewportBinWindow?.[0] ?? 0;
    const vpEnd = viewportBinWindow?.[1] ?? data.manifest.binCount - 1;
    const vpCount = vpEnd - vpStart + 1;
    const x1 = Math.max(0, ((brushTimeWindow[0] - vpStart) / vpCount) * canvas.width);
    const x2 = Math.min(canvas.width, ((brushTimeWindow[1] + 1 - vpStart) / vpCount) * canvas.width);
    if (x2 > x1) {
      context.fillStyle = 'rgba(22, 61, 117, 0.18)';
      for (const machineIndex of brushMachineIndices) {
        const row = displayMachineIndices.indexOf(machineIndex);
        if (row >= 0) {
          context.fillRect(x1, row * rowHeight, x2 - x1, rowHeight);
        }
      }
    }
  }

  if (state.selectedMachineIndex !== null) {
    const row = displayMachineIndices.indexOf(state.selectedMachineIndex);
    if (row >= 0) {
      const rowHeight = canvas.height / Math.max(displayMachineIndices.length, 1);
      context.strokeStyle = 'rgba(22, 61, 117, 0.96)';
      context.lineWidth = 2;
      context.strokeRect(0, row * rowHeight, canvas.width, rowHeight);
    }
  }

  if (hoverMachineIndex !== null && !heatmapDragging) {
    const hoverRow = displayMachineIndices.indexOf(hoverMachineIndex);
    if (hoverRow >= 0) {
      const rowHeight = canvas.height / Math.max(displayMachineIndices.length, 1);
      context.fillStyle = 'rgba(22, 61, 117, 0.12)';
      context.fillRect(0, hoverRow * rowHeight, canvas.width, rowHeight);
    }
  }
}

export function locateHeatmapCell(
  canvas: HTMLCanvasElement | null,
  event: MouseEvent,
  displayMachineIndices: number[],
  binCount: number,
  binWindow: [number, number] | null = null
): { machineIndex: number; binIndex: number; rowIndex: number } | null {
  if (!canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height || !displayMachineIndices.length) {
    return null;
  }
  const effectiveBinStart = binWindow?.[0] ?? 0;
  const effectiveBinEnd = binWindow?.[1] ?? binCount - 1;
  const effectiveBinCount = effectiveBinEnd - effectiveBinStart + 1;
  const binIndex =
    effectiveBinStart +
    Math.max(0, Math.min(effectiveBinCount - 1, Math.floor((x / rect.width) * effectiveBinCount)));
  const rowIndex = Math.max(
    0,
    Math.min(displayMachineIndices.length - 1, Math.floor((y / rect.height) * displayMachineIndices.length))
  );
  return { machineIndex: displayMachineIndices[rowIndex], binIndex, rowIndex };
}

export function renderBrushChart(
  svgNode: SVGSVGElement,
  data: AppData,
  state: AppState,
  setBrushSuppressed: (value: boolean) => void,
  brushSuppressedRef: { value: boolean },
  onWindowChange: (window: [number, number]) => void
): void {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 900;
  const height = 86;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const summary = data.summary.metrics[state.metricId].p90;
  const x = d3.scaleLinear().domain([0, summary.length - 1]).range([CHART_MARGINS.left, width - CHART_MARGINS.right]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - CHART_MARGINS.bottom, CHART_MARGINS.top]);
  const area = d3
    .area<number>()
    .x((_, index) => x(index))
    .y0(height - CHART_MARGINS.bottom)
    .y1((value) => y(value))
    .curve(d3.curveMonotoneX);
  const line = d3
    .line<number>()
    .x((_, index) => x(index))
    .y((value) => y(value))
    .curve(d3.curveMonotoneX);

  svg.append('path').attr('d', area(summary) ?? '').attr('fill', `${METRIC_META[state.metricId].accent}22`);
  svg.append('path').attr('d', line(summary) ?? '').attr('fill', 'none').attr('stroke', METRIC_META[state.metricId].accent).attr('stroke-width', 2.6);

  const axis = d3.axisBottom<number>(x).tickValues([0, 192, 384, 576, 767]).tickFormat((value) => formatTime(value * data.manifest.binSeconds));
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0, ${height - CHART_MARGINS.bottom})`).call(axis);

  const brush = d3
    .brushX()
    .extent([
      [CHART_MARGINS.left, CHART_MARGINS.top],
      [width - CHART_MARGINS.right, height - CHART_MARGINS.bottom]
    ])
    .on('end', (event) => {
      if (brushSuppressedRef.value || !event.sourceEvent || !event.selection) {
        return;
      }
      const [left, right] = event.selection as [number, number];
      const start = Math.max(0, Math.floor(x.invert(left)));
      const end = Math.max(start, Math.min(data.manifest.binCount - 1, Math.ceil(x.invert(right))));
      onWindowChange([start, end]);
    });

  const brushGroup = svg.append('g');
  brushGroup.call(brush as never);
  setBrushSuppressed(true);
  brushGroup.call(brush.move as never, [x(state.timeWindow[0]), x(state.timeWindow[1] + 1)]);
  setBrushSuppressed(false);
}

function getDraftHeatmapSelection(
  heatmapDragStart: { binIndex: number; rowIndex: number } | null,
  heatmapDragCurrent: { binIndex: number; rowIndex: number } | null
): HeatmapSelection | null {
  if (!heatmapDragStart || !heatmapDragCurrent) {
    return null;
  }
  return {
    startBin: Math.min(heatmapDragStart.binIndex, heatmapDragCurrent.binIndex),
    endBin: Math.max(heatmapDragStart.binIndex, heatmapDragCurrent.binIndex),
    startRow: Math.min(heatmapDragStart.rowIndex, heatmapDragCurrent.rowIndex),
    endRow: Math.max(heatmapDragStart.rowIndex, heatmapDragCurrent.rowIndex)
  };
}

function drawHeatmapSelectionMask(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  selection: HeatmapSelection,
  visibleMachineCount: number,
  binCount: number,
  viewportBinWindow: [number, number] | null = null
): void {
  const normalizedVisibleMachineCount = Math.max(visibleMachineCount, 1);

  const vpStart = viewportBinWindow?.[0] ?? 0;
  const vpEnd = viewportBinWindow?.[1] ?? binCount - 1;
  const vpCount = vpEnd - vpStart + 1;

  const x1 = ((selection.startBin - vpStart) / vpCount) * canvas.width;
  const x2 = ((selection.endBin + 1 - vpStart) / vpCount) * canvas.width;
  const y1 = (selection.startRow / normalizedVisibleMachineCount) * canvas.height;
  const y2 = ((selection.endRow + 1) / normalizedVisibleMachineCount) * canvas.height;

  context.save();
  context.fillStyle = 'rgba(243, 245, 247, 0.58)';
  context.fillRect(0, 0, canvas.width, y1);
  context.fillRect(0, y2, canvas.width, canvas.height - y2);
  context.fillRect(0, y1, x1, Math.max(0, y2 - y1));
  context.fillRect(x2, y1, canvas.width - x2, Math.max(0, y2 - y1));
  context.strokeStyle = 'rgba(22, 61, 117, 0.96)';
  context.lineWidth = 2;
  context.setLineDash([6, 5]);
  context.strokeRect(x1 + 1, y1 + 1, Math.max(1, x2 - x1 - 2), Math.max(1, y2 - y1 - 2));
  context.restore();
}
