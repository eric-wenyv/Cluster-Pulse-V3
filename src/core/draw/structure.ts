import * as d3 from 'd3';
import { METRIC_META, METRIC_ORDER } from '../constants';
import type { AppState, MetricId, WindowMachineStat } from '../types';
import { computeSpearmanCorrelation, formatPercent } from '../utils';

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

export type CorrelationCallbacks = {
  onSelectPair: (pair: [MetricId, MetricId]) => void;
  showTooltip: (x: number, y: number, html: string) => void;
  hideTooltip: () => void;
};

export function renderScatter(
  svgNode: SVGSVGElement,
  state: AppState,
  stats: WindowMachineStat[],
  callbacks: ScatterCallbacks,
  scatterPair: [MetricId, MetricId]
): string {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 480;
  const height = svgNode.clientHeight || 280;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  if (!stats.length) return 'No data';

  const [xMetric, yMetric] = scatterPair;

  // Marginal sizing
  const margin = { top: 30, right: 30, bottom: 32, left: 56 };


  const xExtent = d3.extent(stats, d => d.averages[xMetric]) as [number, number];
  const yExtent = d3.extent(stats, d => d.averages[yMetric]) as [number, number];
  
  // Add 10% padding, with a minimum of 5% padding to prevent single points from filling the screen
  const xPad = Math.max(5, (xExtent[1] - xExtent[0]) * 0.1);
  const yPad = Math.max(5, (yExtent[1] - yExtent[0]) * 0.1);
  
  const xDomain = [Math.max(0, xExtent[0] - xPad), Math.min(100, xExtent[1] + xPad)];
  const yDomain = [Math.max(0, yExtent[0] - yPad), Math.min(100, yExtent[1] + yPad)];

  const x = d3.scaleLinear().domain(xDomain).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain(yDomain).range([height - margin.bottom, margin.top]);
  
  const rFixed = 4;

  // Density contours
  const density = d3.contourDensity<WindowMachineStat>()
    .x(d => x(d.averages[xMetric]))
    .y(d => y(d.averages[yMetric]))
    .size([width, height])
    .bandwidth(15)
    .thresholds(10)
    (stats);

  svg.append('g')
    .attr('class', 'contours')
    .selectAll('path')
    .data(density)
    .join('path')
    .attr('fill', `${METRIC_META[state.metricId].accent}`)
    .attr('fill-opacity', d => Math.min(0.8, d.value * 100)) // scale opacity
    .attr('d', d3.geoPath());

  // Axes
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(0, ${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((value) => `${value}%`));
  svg
    .append('g')
    .attr('class', 'axis')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${value}%`));



  // Labels
  svg
    .append('text')
    .attr('x', width - margin.right)
    .attr('y', height - 6)
    .attr('text-anchor', 'end')
    .attr('fill', 'var(--muted)')
    .attr('font-size', 11)
    .text(`${METRIC_META[xMetric].label} 均值`);
  svg
    .append('text')
    .attr('x', 8)
    .attr('y', 14)
    .attr('fill', 'var(--muted)')
    .attr('font-size', 11)
    .text(`${METRIC_META[yMetric].label} 均值`);

  // Points
  svg
    .append('g')
    .selectAll('circle')
    .data(stats)
    .join('circle')
    .attr('cx', (d) => x(d.averages[xMetric]))
    .attr('cy', (d) => y(d.averages[yMetric]))
    .attr('r', rFixed)
    .attr('fill', `rgba(255,255,255,0.2)`) // translucent white on top of density
    .attr('stroke', (d) => (d.machineIndex === state.selectedMachineIndex ? '#231913' : `${METRIC_META[state.metricId].accent}60`))
    .attr('stroke-width', (d) => (d.machineIndex === state.selectedMachineIndex ? 2.4 : 1))
    .style('cursor', 'pointer')
    .on('mouseenter', (event, datum) => {
      callbacks.showTooltip(
        event.clientX,
        event.clientY,
        `<strong>${datum.machine.machineId}</strong><br />FD-${datum.domainId}<br />${METRIC_META[xMetric].label} ${formatPercent(
          datum.averages[xMetric]
        )} · ${METRIC_META[yMetric].label} ${formatPercent(datum.averages[yMetric])}<br />${METRIC_META[state.metricId].label} 峰值 ${formatPercent(
          datum.peaks[state.metricId]
        )}`
      );
    })
    .on('mouseleave', () => callbacks.hideTooltip())
    .on('click', (_, datum) => callbacks.onSelectMachine(datum.machineIndex));

  // Bubble up selected machine
  const selectedStat = stats.find(s => s.machineIndex === state.selectedMachineIndex);
  if (selectedStat) {
    svg.append('circle')
      .attr('cx', x(selectedStat.averages[xMetric]))
      .attr('cy', y(selectedStat.averages[yMetric]))
      .attr('r', rFixed + 2)
      .attr('fill', 'none')
      .attr('stroke', 'var(--ink)')
      .attr('stroke-width', 2);
  }

  return `${stats.length} 台机器，点分布反映了指标间的相关性`;
}

export function renderIcicle(
  svgNode: SVGSVGElement,
  state: AppState,
  machineStats: WindowMachineStat[],
  callbacks: DomainCallbacks
): void {
  const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 480;
  const height = svgNode.clientHeight || 220;
  const svg = d3.select(svgNode);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  if (!machineStats.length) return;

  const rootData: any = { name: 'Cluster', type: 'root', children: [] };
  const fd1Group = d3.group(machineStats, d => d.machine.failureDomain1);
  for (const [fd1, fd1Stats] of fd1Group) {
    const fd1Node: any = { name: fd1, type: 'fd1', domainId: fd1, children: [] };
    rootData.children.push(fd1Node);
    const fd2Group = d3.group(fd1Stats, d => d.machine.failureDomain2);
    for (const [fd2, fd2Stats] of fd2Group) {
      const fd2Node: any = { name: fd2, type: 'fd2', domainId: fd1, children: [] };
      fd1Node.children.push(fd2Node);
      for (const stat of fd2Stats) {
        fd2Node.children.push({
          name: stat.machine.machineId,
          type: 'machine',
          domainId: fd1,
          value: 1,
          peak: stat.peaks[state.metricId],
          machineIndex: stat.machineIndex
        });
      }
      fd2Node.peak = d3.max(fd2Stats, d => d.peaks[state.metricId]) ?? 0;
    }
    fd1Node.peak = d3.max(fd1Stats, d => d.peaks[state.metricId]) ?? 0;
  }

  const root = d3.hierarchy<any>(rootData).sum(d => d.value || 0);
  const partitionRoot = d3.partition<any>().size([width, height])(root);

  // We have 3 layers. 
  // Let's use custom Y for fixed layout: topH for FD1, bottom for FD2
  const topH = height * 0.38;
  const fd1Nodes = partitionRoot.descendants().filter(d => d.depth === 1);
  const fd2Nodes = partitionRoot.descendants().filter(d => d.depth === 2);

  // Draw FD1
  svg.append('g')
    .selectAll('rect')
    .data(fd1Nodes)
    .join('rect')
    .attr('x', d => d.x0)
    .attr('y', 0)
    .attr('width', d => Math.max(0, d.x1 - d.x0 - 1))
    .attr('height', topH)
    .attr('rx', 3)
    .attr('fill', d => {
       const isActive = state.activeDomainId === d.data.domainId;
       return isActive ? METRIC_META[state.metricId].accent : `${METRIC_META[state.metricId].accent}35`;
    })
    .attr('stroke', () => `${METRIC_META[state.metricId].accent}90`)
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      callbacks.showTooltip(event.clientX, event.clientY, `<strong>FD1-${d.data.name}</strong><br/>机器数: ${d.value}<br/>峰值: ${formatPercent(d.data.peak)}`);
    })
    .on('mouseleave', () => callbacks.hideTooltip())
    .on('click', (_, d) => callbacks.onToggleDomain(d.data.domainId));

  svg.append('g')
    .selectAll('text')
    .data(fd1Nodes)
    .join('text')
    .attr('x', d => (d.x0 + d.x1) / 2)
    .attr('y', topH / 2 + 4)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--ink)')
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .style('pointer-events', 'none')
    .text(d => (d.x1 - d.x0) > 30 ? d.data.name : '');

  // Draw FD2
  svg.append('g')
    .selectAll('rect')
    .data(fd2Nodes)
    .join('rect')
    .attr('x', d => d.x0)
    .attr('y', topH + 4)
    .attr('width', d => Math.max(0, d.x1 - d.x0 - 1))
    .attr('height', height - topH - 8)
    .attr('rx', 2)
    .attr('fill', d => {
       const heat = d.data.peak / 100;
       return `rgba(${255*heat|0}, ${60+(1-heat)*100|0}, 50, ${0.5+heat*0.4})`;
    })
    .attr('stroke', 'rgba(0,0,0,0.1)')
    .style('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      callbacks.showTooltip(event.clientX, event.clientY, `<strong>FD2-${d.data.name}</strong><br/>机器数: ${d.value}<br/>峰值: ${formatPercent(d.data.peak)}`);
    })
    .on('mouseleave', () => callbacks.hideTooltip())
    .on('click', (_, d) => callbacks.onToggleDomain(d.data.domainId));

  svg.append('g')
    .selectAll('text')
    .data(fd2Nodes)
    .join('text')
    .attr('x', d => (d.x0 + d.x1) / 2)
    .attr('y', height - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--ink)')
    .attr('font-size', '8px')
    .style('pointer-events', 'none')
    .text(d => (d.x1 - d.x0) > 30 ? d.data.name : '');
}

export function renderCorrelationMatrix(
  canvas: HTMLCanvasElement,
  stats: WindowMachineStat[],
  callbacks: CorrelationCallbacks
): void {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);

  if (!stats.length) return;

  const marginL = 24;
  const marginT = 20;
  const cellW = (width - marginL - 4) / 4;
  const cellH = (height - marginT - 4) / 4;
  const cell = Math.min(cellW, cellH);
  const offX = marginL + (width - marginL - 4 - cell * 4) / 2;
  const offY = marginT + (height - marginT - 4 - cell * 4) / 2;

  // Compute correlation matrix
  const vals: number[][] = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for (let r = 0; r < 4; r++) {
    for (let c = r + 1; c < 4; c++) {
      const metricR = METRIC_ORDER[r];
      const metricC = METRIC_ORDER[c];
      const x = stats.map(s => s.averages[metricR]);
      const y = stats.map(s => s.averages[metricC]);
      const corr = computeSpearmanCorrelation(x, y);
      vals[r][c] = corr;
      vals[c][r] = corr;
    }
  }

  // Draw Labels
  ctx.fillStyle = 'var(--muted)';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const label = METRIC_META[METRIC_ORDER[i]].label;
    // Column Labels (Top)
    ctx.fillText(label, offX + i * cell + cell / 2, offY - 10);
    // Row Labels (Left)
    ctx.save();
    ctx.translate(offX - 10, offY + i * cell + cell / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = vals[r][c];
      const intensity = Math.abs(v);
      const isSelf = r === c;
      
      if (isSelf) {
        ctx.fillStyle = `rgba(138, 145, 156, 0.08)`;
      } else if (v > 0) {
        ctx.fillStyle = `rgba(255, 71, 87, ${0.1 + 0.7 * intensity})`;
      } else {
        ctx.fillStyle = `rgba(6, 214, 160, ${0.1 + 0.7 * intensity})`;
      }
      
      const cx = offX + c * cell;
      const cy = offY + r * cell;
      ctx.fillRect(cx, cy, cell - 2, cell - 2);

      if (isSelf) {
        ctx.fillStyle = 'var(--muted)';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(METRIC_META[METRIC_ORDER[r]].label, cx + cell / 2 - 1, cy + cell / 2 - 1);
      } else {
        ctx.fillStyle = 'var(--ink)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v.toFixed(2), cx + cell / 2 - 1, cy + cell / 2 - 1);
      }
    }
  }

  // Interactivity
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor((x - offX) / cell);
    const r = Math.floor((y - offY) / cell);
    if (r >= 0 && r < 4 && c >= 0 && c < 4 && r !== c) {
      callbacks.onSelectPair([METRIC_ORDER[c], METRIC_ORDER[r]]);
    }
  };
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor((x - offX) / cell);
    const r = Math.floor((y - offY) / cell);
    if (r >= 0 && r < 4 && c >= 0 && c < 4 && r !== c) {
      canvas.style.cursor = 'pointer';
      const metricR = METRIC_META[METRIC_ORDER[r]].label;
      const metricC = METRIC_META[METRIC_ORDER[c]].label;
      callbacks.showTooltip(
        e.clientX,
        e.clientY,
        `<strong>相关性</strong><br />${metricR} 与 ${metricC}<br />Spearman: ${vals[r][c].toFixed(2)}`
      );
    } else {
      canvas.style.cursor = 'default';
      callbacks.hideTooltip();
    }
  };
  canvas.onmouseleave = () => {
    callbacks.hideTooltip();
  };
}
