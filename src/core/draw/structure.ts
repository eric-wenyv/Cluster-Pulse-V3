import * as d3 from 'd3';
import { METRIC_META } from '../constants';
import type { AppData, AppState, DomainRecord, DomainWindowStat, MetricId, WindowMachineStat } from '../types';
import { computeAverage, formatPercent } from '../utils';

export type ScatterCallbacks = {
  showTooltip: (x: number, y: number, html: string) => void;
  hideTooltip: () => void;
  onSelectMachine: (machineIndex: number) => void;
};

export type DomainCallbacks = {
  showTooltip: (x: number, y: number, html: string) => void;
  hideTooltip: () => void;
  onToggleDomain: (domainId: string) => void;
};

export function renderScatter(
  svgNode: SVGSVGElement,
  state: AppState,
  stats: WindowMachineStat[],
  callbacks: ScatterCallbacks
): string {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 480;
  const height = svgNode.clientHeight || 280;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const x = d3.scaleLinear().domain([0, 100]).range([56, width - 18]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - 32, 14]);
  const peakDomain = d3.max(stats, (item) => item.peaks[state.metricId]) ?? 100;
  const radius = d3
    .scaleSqrt<number, number>()
    .domain([0, Math.max(peakDomain, 1)])
    .range([3, Math.max(8, Math.min(width, height) * 0.05)]);

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0, ${height - 32})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((value) => `${value}%`));
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', 'translate(56,0)')
    .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${value}%`));

  svg
    .append('text')
    .attr('x', width - 18)
    .attr('y', height - 6)
    .attr('text-anchor', 'end')
    .attr('fill', 'var(--muted)')
    .attr('font-size', 11)
    .text('CPU 均值');
  svg
    .append('text')
    .attr('x', 8)
    .attr('y', 14)
    .attr('fill', 'var(--muted)')
    .attr('font-size', 11)
    .text('内存均值');

  svg
    .append('g')
    .selectAll('circle')
    .data(stats.slice(0, 240))
    .join('circle')
    .attr('cx', (d) => x(d.averages.cpu))
    .attr('cy', (d) => y(d.averages.memory))
    .attr('r', (d) => radius(d.peaks[state.metricId]))
    .attr('fill', `${METRIC_META[state.metricId].accent}bb`)
    .attr('stroke', (d) => (d.machineIndex === state.selectedMachineIndex ? '#231913' : 'rgba(35, 25, 19, 0.2)'))
    .attr('stroke-width', (d) => (d.machineIndex === state.selectedMachineIndex ? 2.4 : 1))
    .attr('opacity', 0.9)
    .style('cursor', 'pointer')
    .on('mouseenter', (event, datum) => {
      callbacks.showTooltip(
        event.clientX,
        event.clientY,
        `<strong>${datum.machine.machineId}</strong><br />FD-${datum.domainId}<br />CPU ${formatPercent(
          datum.averages.cpu
        )} · 内存 ${formatPercent(datum.averages.memory)}<br />${METRIC_META[state.metricId].label} 峰值 ${formatPercent(
          datum.peaks[state.metricId]
        )}`
      );
    })
    .on('mouseleave', () => callbacks.hideTooltip())
    .on('click', (_, datum) => callbacks.onSelectMachine(datum.machineIndex));

  return `${stats.length} 台机器，圆点大小表示 ${METRIC_META[state.metricId].label} 峰值`;
}

export function renderDomainBars(
  svgNode: SVGSVGElement,
  data: AppData,
  state: AppState,
  machineStats: WindowMachineStat[],
  callbacks: DomainCallbacks
): void {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 480;
  const height = svgNode.clientHeight || 220;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const stats = computeDomainWindowStats(data.domains.domains, machineStats, state.metricId).slice(0, 8);
  if (!stats.length) {
    return;
  }

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(stats, (item) => item.peak) ?? 100])
    .nice()
    .range([86, width - 16]);
  const y = d3
    .scaleBand<string>()
    .domain(stats.map((item) => item.domain.domainId))
    .range([10, height - 28])
    .padding(0.18);

  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0, ${height - 28})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat((value) => `${value}%`));
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', 'translate(86, 0)')
    .call(d3.axisLeft(y).tickFormat((value) => `FD-${value}`));

  svg
    .append('g')
    .selectAll('rect')
    .data(stats)
    .join('rect')
    .attr('class', (d) => `domain-bar ${state.activeDomainId === d.domain.domainId ? 'is-active' : ''}`)
    .attr('x', x(0))
    .attr('y', (d) => y(d.domain.domainId) ?? 0)
    .attr('width', (d) => Math.max(0, x(d.peak) - x(0)))
    .attr('height', y.bandwidth())
    .attr('rx', 6)
    .attr('fill', (d) =>
      state.activeDomainId === d.domain.domainId
        ? METRIC_META[state.metricId].accent
        : `${METRIC_META[d.domain.peakMetric].accent}bb`
    )
    .on('mouseenter', (event, datum) => {
      callbacks.showTooltip(
        event.clientX,
        event.clientY,
        `<strong>FD-${datum.domain.domainId}</strong><br />当前 ${METRIC_META[state.metricId].label} 峰值 ${formatPercent(
          datum.peak
        )}<br />机器数 ${datum.machineCount}`
      );
    })
    .on('mouseleave', () => callbacks.hideTooltip())
    .on('click', (_, datum) => callbacks.onToggleDomain(datum.domain.domainId));
}

function computeDomainWindowStats(
  domains: DomainRecord[],
  machineStats: WindowMachineStat[],
  metricId: MetricId
): DomainWindowStat[] {
  const byDomain = d3.group(machineStats, (stat) => stat.domainId);
  return domains
    .map((domain) => {
      const members = byDomain.get(domain.domainId) ?? [];
      const values = members.map((member) => member.averages[metricId]);
      const peaks = members.map((member) => member.peaks[metricId]);
      return { domain, mean: computeAverage(values), peak: d3.max(peaks) ?? 0, machineCount: members.length };
    })
    .filter((domain) => domain.machineCount > 0)
    .sort((left, right) => right.peak - left.peak || right.mean - left.mean);
}
