import * as d3 from 'd3';
import { METRIC_META } from './constants';
import { loadGrid } from './data';
import { renderHeatmapFilterButton, renderMetricButtons, renderSelectionBadges } from './renderers/controls-renderer';
import { renderDomainBars, renderMachineDetail, renderRankingTable, renderScatter } from './renderers/explorer-renderer';
import { drawHeatmapBase, drawHeatmapOverlay, locateHeatmapCell, renderBrushChart, renderWindowCard, requestOverlayDraw } from './renderers/heatmap-renderer';
import { renderHero, renderSummaryRibbons } from './renderers/overview-renderer';
import { getFilteredMachineIndices, getMachineFilterKey, getVisibleMachineIndices, getWindowMachineStats, normalizeMachineFilter } from './selectors';
import { renderMethodologyMarkup, renderShell } from './templates';
import type { AppData, AppState, GridData, Hotspot, MetricId, WindowMachineStat } from './types';
import { clampWindow, formatPercent, formatWindow, gridValue, isFullWindow } from './utils';

export type { AppData } from './types';
export { loadInitialData } from './data';

export class ClusterPulseApp {
  private readonly root: HTMLElement;
  private readonly data: AppData;
  private gridObserver: IntersectionObserver | null = null;
  private grid: GridData | null = null;
  private state: AppState;
  private readonly tooltip = document.createElement('div');
  private heatmapCanvas?: HTMLCanvasElement;
  private heatmapOverlayCanvas?: HTMLCanvasElement;
  private hoverMachineIndex: number | null = null;
  private heatmapDragStart:
    | {
      clientX: number;
      clientY: number;
      binIndex: number;
      rowIndex: number;
      machineIndex: number;
    }
    | null = null;
  private heatmapDragCurrent:
    | {
      binIndex: number;
      rowIndex: number;
      machineIndex: number;
    }
    | null = null;
  private heatmapDragging = false;
  private cachedVisibleIndicesKey = '';
  private cachedVisibleMachineIndices: number[] = [];
  private cachedWindowStatsKey = '';
  private cachedWindowStats: WindowMachineStat[] = [];
  private readonly heatmapBaseCache = new Map<string, HTMLCanvasElement>();
  private readonly paletteCache = new Map<MetricId, Array<[number, number, number, number]>>();
  private machineMetricPeaks: Record<MetricId, number[]> | null = null;
  private overlayFrameHandle = 0;
  private brushSuppressed = false;
  private prevMetricId: MetricId | null = null;
  private prevActiveDomainId: string | null | undefined = undefined;
  private prevTimeWindow: [number, number] | null = null;
  private prevSelectedMachineIndex: number | null | undefined = undefined;
  private prevMachineFilterKey: string | null = null;
  private renderFrameHandle = 0;

  constructor(rootNode: HTMLElement, data: AppData) {
    this.root = rootNode;
    this.data = data;
    const initialMetric = data.hotspots.highlights[0]?.metricId ?? 'cpu';
    const defaultWindow: [number, number] = [
      data.hotspots.highlights[0]?.startBin ?? data.manifest.defaultWindow.startBin,
      data.hotspots.highlights[0]?.endBin ?? data.manifest.defaultWindow.endBin
    ];
    this.state = {
      metricId: initialMetric,
      timeWindow: clampWindow(defaultWindow, data.manifest.binCount),
      activeDomainId: null,
      selectedMachineIndex: data.hotspots.highlights[0]?.machineIndex ?? null,
      machineFilterIndices: null
    };
  }

  async init(): Promise<void> {
    this.root.innerHTML = renderShell();
    this.tooltip.className = 'tooltip';
    document.body.appendChild(this.tooltip);
    this.attachStaticListeners();
    this.renderHero();
    this.renderMethodology();
    this.renderSummaryRibbons();
    this.renderHotspotLists();
    this.renderMetricButtons();
    this.renderSelectionBadges();
    this.renderHeatmapFilterButton();
    this.installGridObserver();
  }

  destroy(): void {
    this.gridObserver?.disconnect();
    this.gridObserver = null;
    if (this.overlayFrameHandle) {
      cancelAnimationFrame(this.overlayFrameHandle);
      this.overlayFrameHandle = 0;
    }
    if (this.renderFrameHandle) {
      cancelAnimationFrame(this.renderFrameHandle);
      this.renderFrameHandle = 0;
    }
    this.tooltip.remove();
    this.root.innerHTML = '';
  }

  private attachStaticListeners(): void {
    const metricButtons = this.root.querySelector<HTMLDivElement>('#metric-buttons');
    const clearDomainButton = this.root.querySelector<HTMLButtonElement>('#clear-domain-filter');
    const clearHeatmapButton = this.root.querySelector<HTMLButtonElement>('#clear-heatmap-filter');
    const showAllMachinesButton = this.root.querySelector<HTMLButtonElement>('#show-all-machines');
    const heatmapCanvas = this.root.querySelector<HTMLCanvasElement>('#heatmap-base');
    const heatmapOverlayCanvas = this.root.querySelector<HTMLCanvasElement>('#heatmap-overlay');

    if (!metricButtons || !clearDomainButton || !clearHeatmapButton || !showAllMachinesButton || !heatmapCanvas || !heatmapOverlayCanvas) {
      throw new Error('Missing static visualization mount nodes.');
    }

    this.heatmapCanvas = heatmapCanvas;
    this.heatmapOverlayCanvas = heatmapOverlayCanvas;

    metricButtons.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>('button[data-metric]');
      if (!button) {
        return;
      }
      const metricId = button.dataset.metric as MetricId;
      if (metricId !== this.state.metricId) {
        this.state.metricId = metricId;
        this.renderInteractiveViews();
      }
    });

    clearDomainButton.addEventListener('click', () => {
      this.state.activeDomainId = null;
      this.state.machineFilterIndices = null;
      this.renderInteractiveViews();
    });

    clearHeatmapButton.addEventListener('click', () => {
      this.clearHeatmapFilter();
    });

    showAllMachinesButton.addEventListener('click', () => {
      this.state.activeDomainId = null;
      this.state.machineFilterIndices = null;
      this.renderInteractiveViews();
    });

    heatmapOverlayCanvas.addEventListener('pointerdown', (event) => {
      if (!this.grid || event.button !== 0) {
        return;
      }
      const hovered = this.locateHeatmapCell(event);
      if (!hovered) {
        return;
      }
      this.heatmapDragStart = {
        clientX: event.clientX,
        clientY: event.clientY,
        binIndex: hovered.binIndex,
        rowIndex: hovered.rowIndex,
        machineIndex: hovered.machineIndex
      };
      this.heatmapDragCurrent = hovered;
      this.heatmapDragging = false;
      this.hoverMachineIndex = hovered.machineIndex;
      this.hideTooltip();
      heatmapOverlayCanvas.setPointerCapture(event.pointerId);
      this.requestOverlayDraw();
    });

    heatmapOverlayCanvas.addEventListener('pointermove', (event) => {
      if (!this.grid) {
        return;
      }
      const hovered = this.locateHeatmapCell(event);
      if (this.heatmapDragStart) {
        if (!hovered) {
          return;
        }
        this.hoverMachineIndex = hovered.machineIndex;
        this.heatmapDragCurrent = hovered;
        const movedEnough =
          Math.abs(event.clientX - this.heatmapDragStart.clientX) >= 4 ||
          Math.abs(event.clientY - this.heatmapDragStart.clientY) >= 4;
        if (movedEnough) {
          this.heatmapDragging = true;
        }
        this.hideTooltip();
        this.requestOverlayDraw();
        return;
      }
      if (!hovered) {
        this.hoverMachineIndex = null;
        this.requestOverlayDraw();
        this.hideTooltip();
        return;
      }
      this.hoverMachineIndex = hovered.machineIndex;
      const machine = this.data.machines.machines[hovered.machineIndex];
      const value = gridValue(this.grid, this.state.metricId, hovered.binIndex, hovered.machineIndex);
      this.requestOverlayDraw();
      if (value === null) {
        this.hideTooltip();
        return;
      }
      this.showTooltip(
        event.clientX,
        event.clientY,
        `
          <strong>${machine.machineId}</strong><br />
          FD-${machine.failureDomain1} · ${formatWindow([hovered.binIndex, hovered.binIndex], this.data.manifest.binSeconds)}<br />
          ${METRIC_META[this.state.metricId].label}: ${formatPercent(value)}
        `
      );
    });

    heatmapOverlayCanvas.addEventListener('pointerleave', () => {
      if (this.heatmapDragStart) {
        return;
      }
      this.hoverMachineIndex = null;
      this.hideTooltip();
      this.requestOverlayDraw();
    });

    heatmapOverlayCanvas.addEventListener('pointerup', (event) => {
      if (!this.grid || !this.heatmapDragStart) {
        return;
      }
      const started = this.heatmapDragStart;
      const hovered = this.locateHeatmapCell(event) ?? this.heatmapDragCurrent;
      if (heatmapOverlayCanvas.hasPointerCapture(event.pointerId)) {
        heatmapOverlayCanvas.releasePointerCapture(event.pointerId);
      }
      this.heatmapDragStart = null;
      this.heatmapDragCurrent = null;
      const wasDragging = this.heatmapDragging;
      this.heatmapDragging = false;
      this.hideTooltip();
      if (!hovered) {
        this.hoverMachineIndex = null;
        this.requestOverlayDraw();
        return;
      }
      if (!wasDragging) {
        this.state.selectedMachineIndex = hovered.machineIndex;
        this.renderInteractiveViews();
        return;
      }
      this.applyHeatmapBrush(started, hovered);
    });

    heatmapOverlayCanvas.addEventListener('pointercancel', () => {
      this.resetHeatmapDrag();
    });

    this.root.addEventListener('mouseover', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-term-tooltip]');
      if (!target || !this.root.contains(target)) {
        return;
      }
      const label = target.dataset.termLabel;
      const description = target.dataset.termTooltip;
      if (!label || !description) {
        return;
      }
      this.showTooltip(event.clientX, event.clientY, `<strong>${label}</strong><br />${description}`);
    });

    this.root.addEventListener('mousemove', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-term-tooltip]');
      if (!target || !this.root.contains(target)) {
        return;
      }
      const label = target.dataset.termLabel;
      const description = target.dataset.termTooltip;
      if (!label || !description) {
        return;
      }
      this.showTooltip(event.clientX, event.clientY, `<strong>${label}</strong><br />${description}`);
    });

    this.root.addEventListener('mouseout', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-term-tooltip]');
      if (!target || !this.root.contains(target)) {
        return;
      }
      const relatedTarget = event.relatedTarget as Node | null;
      if (relatedTarget && target.contains(relatedTarget)) {
        return;
      }
      this.hideTooltip();
    });

    this.root.addEventListener('focusin', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-term-tooltip]');
      if (!target || !this.root.contains(target)) {
        return;
      }
      const label = target.dataset.termLabel;
      const description = target.dataset.termTooltip;
      if (!label || !description) {
        return;
      }
      const rect = target.getBoundingClientRect();
      this.showTooltip(rect.left + rect.width / 2, rect.bottom, `<strong>${label}</strong><br />${description}`);
    });

    this.root.addEventListener('focusout', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-term-tooltip]');
      if (!target || !this.root.contains(target)) {
        return;
      }
      this.hideTooltip();
    });
  }

  private resetHeatmapDrag(): void {
    this.heatmapDragStart = null;
    this.heatmapDragCurrent = null;
    this.heatmapDragging = false;
    this.hoverMachineIndex = null;
    this.hideTooltip();
    this.requestOverlayDraw();
  }

  private clearHeatmapFilter(): void {
    this.state.timeWindow = [0, this.data.manifest.binCount - 1];
    this.state.machineFilterIndices = null;
    this.renderInteractiveViews();
  }

  private hasActiveHeatmapFilter(): boolean {
    return !isFullWindow(this.state.timeWindow, this.data.manifest.binCount) || !!this.state.machineFilterIndices?.length;
  }

  private renderHeatmapFilterButton(): void {
    renderHeatmapFilterButton(this.root, this.hasActiveHeatmapFilter(), Boolean(this.state.activeDomainId || this.state.machineFilterIndices?.length));
  }

  private applyHeatmapBrush(
    started: { binIndex: number; rowIndex: number; machineIndex: number },
    ended: { binIndex: number; rowIndex: number; machineIndex: number }
  ): void {
    const visibleMachineIndices = this.getVisibleMachineIndices();
    if (!visibleMachineIndices.length) {
      return;
    }
    const startRow = Math.max(0, Math.min(started.rowIndex, ended.rowIndex));
    const endRow = Math.min(visibleMachineIndices.length - 1, Math.max(started.rowIndex, ended.rowIndex));
    const startBin = Math.max(0, Math.min(started.binIndex, ended.binIndex));
    const endBin = Math.min(this.data.manifest.binCount - 1, Math.max(started.binIndex, ended.binIndex));
    const selectedMachines = visibleMachineIndices.slice(startRow, endRow + 1);

    this.state.timeWindow = [startBin, endBin];
    this.state.machineFilterIndices =
      selectedMachines.length === 0 || selectedMachines.length === visibleMachineIndices.length ? null : selectedMachines;
    this.state.selectedMachineIndex = selectedMachines[0] ?? ended.machineIndex;
    this.renderInteractiveViews();
  }

  private installGridObserver(): void {
    const target = this.root.querySelector<HTMLElement>('#pulse');
    if (!target) {
      return;
    }
    this.gridObserver?.disconnect();
    this.gridObserver = new IntersectionObserver(
      async (entries) => {
        const hit = entries.some((entry) => entry.isIntersecting);
        if (!hit) {
          return;
        }
        this.gridObserver?.disconnect();
        await this.ensureGridLoaded();
      },
      { rootMargin: '0px 0px 240px 0px' }
    );
    this.gridObserver.observe(target);
  }

  private async ensureGridLoaded(): Promise<void> {
    if (this.grid) {
      return;
    }
    this.setLoadingState();
    this.grid = await loadGrid(this.data.manifest);
    this.cachedVisibleIndicesKey = '';
    this.cachedWindowStatsKey = '';
    this.machineMetricPeaks = null;
    this.renderInteractiveViews();
  }

  private setLoadingState(): void {
    const heatmapTitle = this.root.querySelector<HTMLElement>('#heatmap-title');
    const windowCopy = this.root.querySelector<HTMLElement>('#window-copy');
    if (heatmapTitle && windowCopy) {
      heatmapTitle.textContent = '正在加载热力图数据…';
      windowCopy.textContent = '当前窗口说明：首次进入主图时延迟加载二进制矩阵，以保证 GitHub Pages 首屏体积可控。';
    }
  }

  private renderInteractiveViews(): void {
    if (this.renderFrameHandle) {
      cancelAnimationFrame(this.renderFrameHandle);
    }
    this.renderFrameHandle = requestAnimationFrame(() => {
      this.renderFrameHandle = 0;
      this.executeRender();
    });
  }

  private executeRender(): void {
    const metricChanged = this.prevMetricId !== this.state.metricId;
    const domainChanged = this.prevActiveDomainId !== this.state.activeDomainId;
    const windowChanged =
      !this.prevTimeWindow ||
      this.prevTimeWindow[0] !== this.state.timeWindow[0] ||
      this.prevTimeWindow[1] !== this.state.timeWindow[1];
    const machineChanged = this.prevSelectedMachineIndex !== this.state.selectedMachineIndex;
    const isFirstRender = this.prevMetricId === null;

    this.renderMetricButtons();

    if (!this.grid) {
      this.renderSelectionBadges();
      this.renderHeatmapFilterButton();
      return;
    }

    this.normalizeMachineFilter();
    const machineFilterKey = this.getMachineFilterKey();
    const machineFilterChanged = this.prevMachineFilterKey !== machineFilterKey;

    this.prevMetricId = this.state.metricId;
    this.prevActiveDomainId = this.state.activeDomainId;
    this.prevTimeWindow = [this.state.timeWindow[0], this.state.timeWindow[1]];
    this.prevSelectedMachineIndex = this.state.selectedMachineIndex;
    this.prevMachineFilterKey = machineFilterKey;

    this.renderSelectionBadges();
    this.renderHeatmapFilterButton();
    const visibleStats = this.getWindowMachineStats();
    if (!visibleStats.length) {
      return;
    }

    const selectedVisible = visibleStats.find((item) => item.machineIndex === this.state.selectedMachineIndex);
    let selectedMachineAdjusted = false;
    if (!selectedVisible) {
      this.state.selectedMachineIndex = visibleStats[0].machineIndex;
      selectedMachineAdjusted = true;
    }

    this.renderWindowCard(visibleStats);

    if (isFirstRender || metricChanged || windowChanged) {
      this.renderBrushChart();
    }

    if (isFirstRender || metricChanged || domainChanged) {
      this.drawHeatmapBase();
    }

    this.drawHeatmapOverlay();

    if (isFirstRender || metricChanged || domainChanged || windowChanged || machineFilterChanged) {
      this.renderScatter(visibleStats);
      this.renderDomainBars(visibleStats);
      this.renderRankingTable(visibleStats);
    }

    if (isFirstRender || machineChanged || selectedMachineAdjusted || metricChanged || domainChanged || windowChanged || machineFilterChanged) {
      this.renderMachineDetail();
    }
  }

  private renderMetricButtons(): void {
    renderMetricButtons(this.root, this.data, this.state);
  }

  private renderHero(): void {
    renderHero(this.root, this.data);
  }

  private renderSummaryRibbons(): void {
    renderSummaryRibbons(this.root, this.data);
  }

  private renderHotspotLists(): void {
    const heroHighlights = this.root.querySelector<HTMLDivElement>('#hero-highlights');

    if (heroHighlights) {
      heroHighlights.querySelectorAll<HTMLAnchorElement>('a[data-hotspot-id]').forEach((anchor) => {
        anchor.addEventListener('click', (event) => {
          event.preventDefault();
          const hotspot = this.data.hotspots.highlights.find((item) => item.id === anchor.dataset.hotspotId);
          if (!hotspot) {
            return;
          }
          this.activateHotspot(hotspot);
        });
      });
    }
  }

  private activateHotspot(hotspot: Hotspot): void {
    this.state.metricId = hotspot.metricId;
    this.state.timeWindow = [hotspot.startBin, hotspot.endBin];
    this.state.activeDomainId = null;
    this.state.machineFilterIndices = null;
    this.state.selectedMachineIndex = hotspot.machineIndex;
    this.renderInteractiveViews();
    if (!this.grid) {
      void this.ensureGridLoaded();
    }
    this.root.querySelector<HTMLElement>('#pulse')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private getMachineFilterKey(): string {
    return getMachineFilterKey(this.state.machineFilterIndices);
  }

  private normalizeMachineFilter(): void {
    this.state.machineFilterIndices = normalizeMachineFilter(this.state.machineFilterIndices, this.getVisibleMachineIndices());
  }

  private getFilteredMachineIndices(): number[] {
    return getFilteredMachineIndices(this.state.machineFilterIndices, this.getVisibleMachineIndices());
  }

  private renderSelectionBadges(): void {
    renderSelectionBadges(this.root, this.data, this.state, this.getVisibleMachineIndices().length, this.getFilteredMachineIndices().length);
  }

  private getVisibleMachineIndices(): number[] {
    const result = getVisibleMachineIndices({
      data: this.data,
      state: this.state,
      cachedVisibleIndicesKey: this.cachedVisibleIndicesKey,
      cachedVisibleMachineIndices: this.cachedVisibleMachineIndices,
      machineMetricPeaks: this.machineMetricPeaks,
      grid: this.grid
    });
    this.cachedVisibleIndicesKey = result.cacheKey;
    this.cachedVisibleMachineIndices = result.visibleMachineIndices;
    this.machineMetricPeaks = result.machineMetricPeaks;
    return this.cachedVisibleMachineIndices;
  }

  private getWindowMachineStats(): WindowMachineStat[] {
    const result = getWindowMachineStats({
      data: this.data,
      state: this.state,
      grid: this.grid,
      filteredMachineIndices: this.getFilteredMachineIndices(),
      cachedWindowStatsKey: this.cachedWindowStatsKey,
      cachedWindowStats: this.cachedWindowStats,
      machineFilterKey: this.getMachineFilterKey()
    });
    this.cachedWindowStatsKey = result.cacheKey;
    this.cachedWindowStats = result.stats;
    return this.cachedWindowStats;
  }

  private renderWindowCard(stats: WindowMachineStat[]): void {
    renderWindowCard(
      this.root,
      this.data,
      this.state,
      stats,
      this.getFilteredMachineIndices().length,
      this.getVisibleMachineIndices().length
    );
  }

  private drawHeatmapBase(): void {
    if (!this.grid || !this.heatmapCanvas) {
      return;
    }
    drawHeatmapBase(
      this.heatmapCanvas,
      this.data,
      this.grid,
      this.state.metricId,
      this.state.activeDomainId,
      this.getVisibleMachineIndices(),
      this.heatmapBaseCache,
      (metricId) => this.getPalette(metricId)
    );
  }

  private drawHeatmapOverlay(): void {
    if (!this.heatmapOverlayCanvas) {
      return;
    }
    drawHeatmapOverlay(
      this.heatmapOverlayCanvas,
      this.data,
      this.state,
      this.getVisibleMachineIndices(),
      this.getFilteredMachineIndices(),
      this.hoverMachineIndex,
      this.heatmapDragging,
      this.heatmapDragStart ? { binIndex: this.heatmapDragStart.binIndex, rowIndex: this.heatmapDragStart.rowIndex } : null,
      this.heatmapDragCurrent ? { binIndex: this.heatmapDragCurrent.binIndex, rowIndex: this.heatmapDragCurrent.rowIndex } : null
    );
  }

  private requestOverlayDraw(): void {
    requestOverlayDraw(this.overlayFrameHandle, (value) => {
      this.overlayFrameHandle = value;
    }, () => this.drawHeatmapOverlay());
  }

  private locateHeatmapCell(event: MouseEvent): { machineIndex: number; binIndex: number; rowIndex: number } | null {
    return locateHeatmapCell(this.heatmapOverlayCanvas, event, this.getVisibleMachineIndices(), this.data.manifest.binCount);
  }

  private renderBrushChart(): void {
    renderBrushChart(this.root, this.data, this.state, this.brushSuppressed, (value) => {
      this.brushSuppressed = value;
    }, (window) => {
      this.state.timeWindow = window;
      this.renderInteractiveViews();
    });
  }

  private renderScatter(stats: WindowMachineStat[]): void {
    if (!this.grid) {
      return;
    }
    renderScatter(this.root, this.grid, this.state, stats, (x, y, html) => this.showTooltip(x, y, html), () => this.hideTooltip(), (machineIndex) => {
      this.state.selectedMachineIndex = machineIndex;
      this.renderInteractiveViews();
    });
  }

  private renderDomainBars(machineStats: WindowMachineStat[]): void {
    if (!this.grid) {
      return;
    }
    renderDomainBars(this.root, this.grid, this.data, this.state, machineStats, (x, y, html) => this.showTooltip(x, y, html), () => this.hideTooltip(), (domainId) => {
      this.state.activeDomainId = this.state.activeDomainId === domainId ? null : domainId;
      this.renderInteractiveViews();
    });
  }

  private renderRankingTable(stats: WindowMachineStat[]): void {
    renderRankingTable(this.root, this.state, stats, (machineIndex) => {
      this.state.selectedMachineIndex = machineIndex;
      this.renderInteractiveViews();
    });
  }

  private renderMachineDetail(): void {
    if (!this.grid) {
      return;
    }
    this.state.selectedMachineIndex = renderMachineDetail(this.root, this.data, this.grid, this.state);
  }

  private renderMethodology(): void {
    const container = this.root.querySelector<HTMLElement>('#method-grid');
    if (!container) {
      return;
    }

    const leadHighlight = this.data.hotspots.highlights[0];
    container.innerHTML = renderMethodologyMarkup(this.data, leadHighlight);
  }

  private showTooltip(x: number, y: number, html: string): void {
    this.tooltip.innerHTML = html;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
    this.tooltip.classList.add('is-visible');
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('is-visible');
  }

  private getPalette(metricId: MetricId): Array<[number, number, number, number]> {
    const cached = this.paletteCache.get(metricId);
    if (cached) {
      return cached;
    }
    const palette = buildPalette(metricId);
    this.paletteCache.set(metricId, palette);
    return palette;
  }
}

function buildPalette(metricId: MetricId): Array<[number, number, number, number]> {
  return Array.from({ length: 101 }, (_, index) => {
    const color = d3.rgb(METRIC_META[metricId].interpolator(index / 100));
    return [color.r, color.g, color.b, 255];
  });
}
