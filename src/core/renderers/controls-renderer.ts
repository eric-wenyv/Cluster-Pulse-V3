import { METRIC_META } from '../constants';
import type { AppData, AppState } from '../types';
import { formatWindow } from '../utils';

export function renderHeatmapFilterButton(root: HTMLElement, hasActiveHeatmapFilter: boolean, hasScopeFilter: boolean): void {
  const button = root.querySelector<HTMLButtonElement>('#clear-heatmap-filter');
  const showAllMachinesButton = root.querySelector<HTMLButtonElement>('#show-all-machines');
  if (!button || !showAllMachinesButton) {
    return;
  }
  button.disabled = !hasActiveHeatmapFilter;
  showAllMachinesButton.disabled = !hasScopeFilter;
}

export function renderMetricButtons(root: HTMLElement, data: AppData, state: AppState): void {
  const container = root.querySelector<HTMLDivElement>('#metric-buttons');
  const help = root.querySelector<HTMLDivElement>('#metric-help');
  const legend = root.querySelector<HTMLDivElement>('#legend-gradient');
  if (!container || !help || !legend) {
    return;
  }

  if (!container.childElementCount) {
    container.innerHTML = data.manifest.metrics
      .map(
        (metric) => `
          <button
            type="button"
            class="metric-button"
            data-metric="${metric.id}"
          >
            ${METRIC_META[metric.id].label}
          </button>
        `
      )
      .join('');
  }

  container.querySelectorAll<HTMLButtonElement>('button[data-metric]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.metric === state.metricId);
  });

  help.textContent = METRIC_META[state.metricId].description;
  legend.style.background = `linear-gradient(90deg, ${Array.from({ length: 12 }, (_, index) => METRIC_META[state.metricId].interpolator(index / 11)).join(', ')})`;
}

export function renderSelectionBadges(root: HTMLElement, data: AppData, state: AppState, visibleMachineCount: number, filteredMachineCount: number): void {
  const container = root.querySelector<HTMLDivElement>('#selection-badges');
  if (!container) {
    return;
  }
  const badges = [
    `指标：${METRIC_META[state.metricId].label}`,
    `窗口：${formatWindow(state.timeWindow, data.manifest.binSeconds)}`,
    `机器：${filteredMachineCount}/${visibleMachineCount}`,
    `范围：${state.activeDomainId ? `FD-${state.activeDomainId}` : '全部故障域'}`
  ];
  container.innerHTML = badges.map((text) => `<span>${text}</span>`).join('');
}
