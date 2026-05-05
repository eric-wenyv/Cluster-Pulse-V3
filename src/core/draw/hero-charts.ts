import * as d3 from 'd3';
import { METRIC_META, METRIC_ORDER } from '../constants';
import type { AppData, AppState, BatchGrid, ContainerGrid, MetricId } from '../types';
import { formatTime, metricIndex } from '../utils';

export function computeContainerSeries(containerGrid: ContainerGrid | null, binCount: number, machineCount: number): number[] {
  const series = new Array(binCount).fill(0);
  if (!containerGrid || containerGrid.machineCount === 0) {
    return series;
  }
  const validMachineCount = containerGrid.machineCount;
  for (let bin = 0; bin < binCount; bin += 1) {
    let sum = 0;
    for (let machine = 0; machine < validMachineCount; machine += 1) {
      sum += containerGrid.values[machine * binCount + bin];
    }
    series[bin] = sum / machineCount;
  }
  return series;
}

export function computeBatchSeries(batchGrid: BatchGrid | null, binCount: number, machineCount: number): number[] {
  const series = new Array(binCount).fill(0);
  if (!batchGrid || batchGrid.machineCount === 0) {
    return series;
  }
  const metricOffset = metricIndex('cpu') * binCount * batchGrid.machineCount;
  const validMachineCount = batchGrid.machineCount;
  for (let bin = 0; bin < binCount; bin += 1) {
    let sum = 0;
    let validCount = 0;
    for (let machine = 0; machine < validMachineCount; machine += 1) {
      const val = batchGrid.bytes[metricOffset + bin * validMachineCount + machine];
      if (val !== batchGrid.missingValue) {
        sum += val;
        validCount += 1;
      }
    }
    series[bin] = validCount > 0 ? sum / machineCount : 0; // Using machineCount to reflect average load across whole cluster
  }
  return series;
}

export function renderStreamgraph(
  svgNode: SVGSVGElement,
  data: AppData,
  state: AppState,
  callbacks: { onWindowChange: (window: [number, number]) => void }
): void {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 900;
  const height = svgNode.clientHeight || 140;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const binCount = data.manifest.binCount;
  const seriesData = Array.from({ length: binCount }, (_, i) => {
    const item: Record<string, number> = { index: i };
    METRIC_ORDER.forEach(metricId => {
      item[metricId] = data.summary.metrics[metricId].p99[i];
    });
    return item;
  });

  const stack = d3.stack<any>()
    .keys(METRIC_ORDER)
    .offset(d3.stackOffsetWiggle)
    .order(d3.stackOrderInsideOut);
  
  const stacked = stack(seriesData);

  const x = d3.scaleLinear()
    .domain([0, binCount - 1])
    .range([0, width]);

  const yMin = d3.min(stacked, layer => d3.min(layer, d => d[0])) || 0;
  const yMax = d3.max(stacked, layer => d3.max(layer, d => d[1])) || 100;
  
  // Add some padding to Y scale
  const yPadding = (yMax - yMin) * 0.1;
  const y = d3.scaleLinear()
    .domain([yMin - yPadding, yMax + yPadding])
    .range([height, 0]);

  const area = d3.area<any>()
    .x(d => x(d.data.index))
    .y0(d => y(d[0]))
    .y1(d => y(d[1]))
    .curve(d3.curveMonotoneX);

  svg.append('g')
    .selectAll('path')
    .data(stacked)
    .join('path')
    .attr('fill', d => METRIC_META[d.key as MetricId].accent)
    .attr('opacity', d => d.key === state.metricId ? 0.9 : 0.6)
    .attr('d', area);

  // Brush logic
  const brush = d3.brushX()
    .extent([[0, 0], [width, height]])
    .on('end', (event) => {
      if (!event.sourceEvent) {
        return;
      }
      if (!event.selection) {
        callbacks.onWindowChange([0, binCount - 1]);
        return;
      }
      const [left, right] = event.selection as [number, number];
      const start = Math.max(0, Math.floor(x.invert(left)));
      const end = Math.max(start, Math.min(binCount - 1, Math.ceil(x.invert(right))));
      callbacks.onWindowChange([start, end]);
    });

  const brushGroup = svg.append('g').attr('class', 'stream-brush');
  brushGroup.call(brush as any);
  
  // Highlight the current time window
  if (state.timeWindow[0] === 0 && state.timeWindow[1] === binCount - 1) {
    brushGroup.call(brush.move as any, null);
  } else {
    brushGroup.call(brush.move as any, [x(state.timeWindow[0]), x(state.timeWindow[1] + 1)]);
  }
}

export function renderMirrorChart(
  svgNode: SVGSVGElement,
  data: AppData,
  state: AppState,
  containerSeries: number[],
  batchSeries: number[],
  callbacks: {
    showTooltip: (x: number, y: number, html: string) => void;
    hideTooltip: () => void;
  }
): void {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 900;
  const height = svgNode.clientHeight || 100;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const binCount = data.manifest.binCount;
  
  const x = d3.scaleLinear()
    .domain([0, binCount - 1])
    .range([0, width]);

  const midY = height / 2;
  
  const maxContainer = d3.max(containerSeries) || 1;
  const yContainer = d3.scaleLinear()
    .domain([0, maxContainer])
    .range([midY, 0]);

  const maxBatch = d3.max(batchSeries) || 100;
  const yBatch = d3.scaleLinear()
    .domain([0, maxBatch])
    .range([midY, height]);

  const areaContainer = d3.area<number>()
    .x((_, i) => x(i))
    .y0(midY)
    .y1(d => yContainer(d))
    .curve(d3.curveMonotoneX);

  const areaBatch = d3.area<number>()
    .x((_, i) => x(i))
    .y0(midY)
    .y1(d => yBatch(d))
    .curve(d3.curveMonotoneX);

  svg.append('path')
    .datum(containerSeries)
    .attr('fill', '#178f8f')
    .attr('opacity', 0.85)
    .attr('d', areaContainer);

  svg.append('path')
    .datum(batchSeries)
    .attr('fill', '#d66d2e')
    .attr('opacity', 0.85)
    .attr('d', areaBatch);

  // Baseline
  svg.append('line')
    .attr('x1', 0)
    .attr('y1', midY)
    .attr('x2', width)
    .attr('y2', midY)
    .attr('stroke', 'var(--line-strong)')
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.8);

  // Add day markers
  const axisGroup = svg.append('g').attr('class', 'axis-days');
  const ticks = [];
  for (let i = 0; i < binCount; i += 96) { // 96 bins = 1 day (15m bins)
    ticks.push(i);
  }
  
  ticks.forEach((tick, idx) => {
    if (idx > 0) {
      axisGroup.append('line')
        .attr('x1', x(tick))
        .attr('y1', 0)
        .attr('x2', x(tick))
        .attr('y2', height)
        .attr('stroke', 'var(--line)')
        .attr('stroke-dasharray', '2,2');
        
      axisGroup.append('text')
        .attr('x', x(tick) + 4)
        .attr('y', height - 4)
        .attr('fill', 'var(--muted)')
        .attr('font-size', '10px')
        .text(`Day ${idx + 1}`);
    }
  });

  // Brush overlay for timeWindow highlighting
  if (state.timeWindow[0] !== 0 || state.timeWindow[1] !== binCount - 1) {
    const brushGroup = svg.append('g');
    brushGroup.append('rect')
      .attr('x', x(state.timeWindow[0]))
      .attr('y', 0)
      .attr('width', x(state.timeWindow[1] + 1) - x(state.timeWindow[0]))
      .attr('height', height)
      .attr('fill', 'rgba(0, 0, 0, 0.05)')
      .attr('stroke', 'rgba(0, 0, 0, 0.2)')
      .attr('pointer-events', 'none');
  }

  // Invisible rect for tooltips
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mouseX] = d3.pointer(event);
      const binIndex = Math.floor(x.invert(mouseX));
      if (binIndex >= 0 && binIndex < binCount) {
        const timeStr = formatTime(binIndex * data.manifest.binSeconds);
        const p99s = METRIC_ORDER.map(m => `${METRIC_META[m].label}: ${data.summary.metrics[m].p99[binIndex]}%`).join('<br/>');
        const cont = containerSeries[binIndex].toFixed(1);
        const b = batchSeries[binIndex].toFixed(1);
        
        callbacks.showTooltip(
          event.clientX,
          event.clientY,
          `<strong>${timeStr}</strong><br/>` +
          `在线容器平均: ${cont}/台<br/>` +
          `批处理CPU平均: ${b}%<br/>` +
          `<hr style="border:0; border-top:1px solid rgba(255,255,255,0.2); margin:4px 0" />` +
          `<span style="font-size:0.85em; opacity:0.9">${p99s}</span>`
        );
      }
    })
    .on('mouseleave', () => callbacks.hideTooltip());
}
