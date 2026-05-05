import * as d3 from 'd3';
import { METRIC_ORDER } from './constants';
import type { GridData, MetricId } from './types';

export function resolveAsset(path: string): string {
  return new URL(path, document.baseURI).toString();
}

export function formatNumber(value: number): string {
  return d3.format(',')(Math.round(value));
}

export function formatPercent(value: number): string {
  return `${d3.format('.1f')(value)}%`;
}

export function clampWindow(window: [number, number], binCount: number): [number, number] {
  const start = Math.max(0, Math.min(binCount - 1, window[0]));
  const end = Math.max(start, Math.min(binCount - 1, window[1]));
  return [start, end];
}

export function isFullWindow(window: [number, number], binCount: number): boolean {
  return window[0] === 0 && window[1] === binCount - 1;
}

export function formatTime(valueSeconds: number): string {
  const totalMinutes = Math.floor(valueSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const dayIndex = Math.floor(hours / 24);
  const dayHour = hours % 24;
  if (dayIndex > 0) {
    return `D${dayIndex + 1} ${String(dayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return `${String(dayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatWindow(window: [number, number], binSeconds: number): string {
  const [startBin, endBin] = window;
  return `${formatTime(startBin * binSeconds)} - ${formatTime((endBin + 1) * binSeconds)}`;
}

export function metricIndex(metricId: MetricId): number {
  return METRIC_ORDER.indexOf(metricId);
}

export function gridValue(grid: GridData, metricId: MetricId, binIndex: number, machineIndex: number): number | null {
  const value =
    grid.bytes[metricIndex(metricId) * grid.binCount * grid.machineCount + binIndex * grid.machineCount + machineIndex];
  return value === grid.missingValue ? null : value;
}

export function computeAverage(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderTerm(label: string, description: string): string {
  return `<span class="term-hint" tabindex="0" data-term-label="${escapeHtml(label)}" data-term-tooltip="${escapeHtml(description)}">${escapeHtml(label)}</span>`;
}

function computeRanks(arr: number[]): number[] {
  const sorted = [...arr].map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].val === sorted[i].val) {
      j++;
    }
    const rank = (i + j - 1) / 2 + 1; // Average rank
    for (let k = i; k < j; k++) {
      ranks[sorted[k].i] = rank;
    }
    i = j;
  }
  return ranks;
}

export function computeSpearmanCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  const n = x.length;
  const rankX = computeRanks(x);
  const rankY = computeRanks(y);
  
  let sumDSq = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    sumDSq += d * d;
  }
  
  return 1 - (6 * sumDSq) / (n * (n * n - 1));
}
