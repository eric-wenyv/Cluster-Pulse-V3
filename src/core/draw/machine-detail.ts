import * as d3 from 'd3';
import { METRIC_META, METRIC_ORDER } from '../constants';
import type { AppData, AppState, GridData, MachineRecord, MetricId } from '../types';
import { formatTime, gridValue } from '../utils';

export function renderMachineDetail(
  container: HTMLElement,
  data: AppData,
  grid: GridData,
  state: AppState,
  machine: MachineRecord
): void {
  container.innerHTML = METRIC_ORDER.map(
    (metricId) =>
      `<div class="small-metric"><span class="label">${METRIC_META[metricId].label}</span><svg data-machine-metric="${metricId}"></svg></div>`
  ).join('');

  METRIC_ORDER.forEach((metricId) => {
    const svgNode = container.querySelector<SVGSVGElement>(`svg[data-machine-metric="${metricId}"]`);
    if (!svgNode) {
      return;
    }
    drawMetricLine(svgNode, data, grid, state, machine, metricId);
  });
}

function drawMetricLine(
  svgNode: SVGSVGElement,
  data: AppData,
  grid: GridData,
  state: AppState,
  machine: MachineRecord,
  metricId: MetricId
): void {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 320;
  const height = svgNode.clientHeight || 96;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const values = Array.from({ length: data.manifest.binCount }, (_, index) => gridValue(grid, metricId, index, machine.index) ?? 0);
  const x = d3.scaleLinear().domain([0, values.length - 1]).range([42, width - 14]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - 22, 8]);
  const line = d3
    .line<number>()
    .x((_, index) => x(index))
    .y((value) => y(value))
    .curve(d3.curveMonotoneX);
  const [windowStart, windowEnd] = state.timeWindow;

  svg
    .append('rect')
    .attr('x', x(windowStart))
    .attr('y', 8)
    .attr('width', Math.max(0, x(windowEnd + 1) - x(windowStart)))
    .attr('height', height - 30)
    .attr('fill', `${METRIC_META[metricId].accent}1f`);
  svg.append('path').attr('d', line(values) ?? '').attr('fill', 'none').attr('stroke', METRIC_META[metricId].accent).attr('stroke-width', 2);
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0, ${height - 22})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues([0, 192, 384, 576, 767])
        .tickFormat((value) => formatTime(Number(value) * data.manifest.binSeconds))
    );
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', 'translate(42, 0)')
    .call(d3.axisLeft(y).ticks(3).tickFormat((value) => `${value}%`));
}
