import * as d3 from 'd3';
import { CHART_MARGINS, METRIC_META } from '../constants';
import type { AppData, AppState, GridData, MetricId } from '../types';
import { formatTime, gridValue, isFullWindow } from '../utils';

export type HeatmapSelection = { startBin: number; endBin: number; startRow: number; endRow: number };

export function buildPalette(metricId: MetricId): Array<[number, number, number, number]> {
  return Array.from({ length: 101 }, (_, index) => {
    const color = d3.rgb(METRIC_META[metricId].interpolator(index / 100));
    return [color.r, color.g, color.b, 255];
  });
}

export function drawHeatmapBase(
  canvas: HTMLCanvasElement,
  data: AppData,
  grid: GridData,
  metricId: MetricId,
  activeDomainId: string | null,
  visibleMachineIndices: number[],
  heatmapBaseCache: Map<string, HTMLCanvasElement>,
  getPalette: (metricId: MetricId) => Array<[number, number, number, number]>
): void {
  const srcWidth = data.manifest.binCount;
  const srcHeight = Math.max(visibleMachineIndices.length, 1);
  const cacheKey = `${metricId}:${activeDomainId ?? 'all'}`;
  let offscreen = heatmapBaseCache.get(cacheKey);

  if (!offscreen) {
    offscreen = document.createElement('canvas');
    offscreen.width = srcWidth;
    offscreen.height = srcHeight;
    const offContext = offscreen.getContext('2d');
    if (!offContext) {
      return;
    }
    const image = offContext.createImageData(srcWidth, srcHeight);
    const palette = getPalette(metricId);

    visibleMachineIndices.forEach((machineIndex, row) => {
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

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
}

export function drawHeatmapOverlay(
  canvas: HTMLCanvasElement,
  data: AppData,
  state: AppState,
  visibleMachineIndices: number[],
  filteredMachineIndices: number[],
  hoverMachineIndex: number | null,
  heatmapDragging: boolean,
  heatmapDragStart: { binIndex: number; rowIndex: number } | null,
  heatmapDragCurrent: { binIndex: number; rowIndex: number } | null
): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);

  const activeSelection = heatmapDragging
    ? getDraftHeatmapSelection(heatmapDragStart, heatmapDragCurrent)
    : getCommittedHeatmapSelection(data, state, visibleMachineIndices, filteredMachineIndices);
  if (activeSelection) {
    drawHeatmapSelectionMask(context, canvas, activeSelection, visibleMachineIndices.length, data.manifest.binCount);
  }

  if (state.selectedMachineIndex !== null) {
    const row = visibleMachineIndices.indexOf(state.selectedMachineIndex);
    if (row >= 0) {
      const rowHeight = canvas.height / Math.max(visibleMachineIndices.length, 1);
      context.strokeStyle = 'rgba(22, 61, 117, 0.96)';
      context.lineWidth = 2;
      context.strokeRect(0, row * rowHeight, canvas.width, rowHeight);
    }
  }

  if (hoverMachineIndex !== null && !heatmapDragging) {
    const hoverRow = visibleMachineIndices.indexOf(hoverMachineIndex);
    if (hoverRow >= 0) {
      const rowHeight = canvas.height / Math.max(visibleMachineIndices.length, 1);
      context.fillStyle = 'rgba(22, 61, 117, 0.12)';
      context.fillRect(0, hoverRow * rowHeight, canvas.width, rowHeight);
    }
  }
}

export function locateHeatmapCell(
  canvas: HTMLCanvasElement | null,
  event: MouseEvent,
  visibleMachineIndices: number[],
  binCount: number
): { machineIndex: number; binIndex: number; rowIndex: number } | null {
  if (!canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height || !visibleMachineIndices.length) {
    return null;
  }
  const binIndex = Math.max(0, Math.min(binCount - 1, Math.floor((x / rect.width) * binCount)));
  const rowIndex = Math.max(0, Math.min(visibleMachineIndices.length - 1, Math.floor((y / rect.height) * visibleMachineIndices.length)));
  return { machineIndex: visibleMachineIndices[rowIndex], binIndex, rowIndex };
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

function getCommittedHeatmapSelection(
  data: AppData,
  state: AppState,
  visibleMachineIndices: number[],
  filteredMachineIndices: number[]
): HeatmapSelection | null {
  if (!visibleMachineIndices.length) {
    return null;
  }
  const hasTimeFilter = !isFullWindow(state.timeWindow, data.manifest.binCount);
  const hasMachineFilter = filteredMachineIndices.length !== visibleMachineIndices.length;
  if (!hasTimeFilter && !hasMachineFilter) {
    return null;
  }
  const rowPositions = hasMachineFilter
    ? filteredMachineIndices.map((machineIndex) => visibleMachineIndices.indexOf(machineIndex)).filter((rowIndex) => rowIndex >= 0)
    : [0, visibleMachineIndices.length - 1];
  if (!rowPositions.length) {
    return null;
  }
  return {
    startBin: hasTimeFilter ? state.timeWindow[0] : 0,
    endBin: hasTimeFilter ? state.timeWindow[1] : data.manifest.binCount - 1,
    startRow: Math.min(...rowPositions),
    endRow: Math.max(...rowPositions)
  };
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
  binCount: number
): void {
  const normalizedVisibleMachineCount = Math.max(visibleMachineCount, 1);
  const x1 = (selection.startBin / binCount) * canvas.width;
  const x2 = ((selection.endBin + 1) / binCount) * canvas.width;
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
