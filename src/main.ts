import * as d3 from 'd3';
import './styles.css';

type MetricId = 'cpu' | 'memory' | 'network' | 'disk';

type MetricSummary = {
  mean: number[];
  p90: number[];
  p99: number[];
  max: number[];
};

type Manifest = {
  version: number;
  dataset: string;
  generatedAt: string;
  subsetMode: string;
  usageRowCount: number;
  machineCount: number;
  failureDomainCount: number;
  binSeconds: number;
  periodSeconds: number;
  binCount: number;
  missingValue: number;
  metrics: Array<{
    id: MetricId;
    label: string;
    unit: string;
    description: string;
  }>;
  defaultWindow: {
    startBin: number;
    endBin: number;
  };
  notes: string[];
  sources: Record<string, string>;
};

type MachineRecord = {
  index: number;
  machineId: string;
  failureDomain1: string;
  failureDomain2: string;
  cpuNum: number;
  memSize: number;
  status: string;
  events: Array<{ time: number; status: string }>;
  availableBins: number;
  globalPeakScore: number;
  globalPeakMetric: MetricId;
  peakBin: number;
};

type MachinesFile = {
  machines: MachineRecord[];
};

type ClusterSummary = {
  times: number[];
  metrics: Record<MetricId, MetricSummary>;
};

type Hotspot = {
  id: string;
  title: string;
  summary: string;
  metricId: MetricId;
  startBin: number;
  endBin: number;
  peakBin: number;
  peakValue: number;
  score: number;
  machineId: string;
  machineIndex: number;
  domainId: string;
};

type HotspotsFile = {
  highlights: Hotspot[];
  findings: string[];
};

type DomainRecord = {
  domainId: string;
  label: string;
  machineCount: number;
  machineIndices: number[];
  globalPeakScore: number;
  peakMetric: MetricId;
};

type DomainsFile = {
  domains: DomainRecord[];
};

type AppData = {
  manifest: Manifest;
  machines: MachinesFile;
  summary: ClusterSummary;
  hotspots: HotspotsFile;
  domains: DomainsFile;
};

type WindowMachineStat = {
  machineIndex: number;
  machine: MachineRecord;
  domainId: string;
  averages: Record<MetricId, number>;
  counts: Record<MetricId, number>;
  peaks: Record<MetricId, number>;
  windowPeak: number;
  peakMetric: MetricId;
  peakValue: number;
};

type DomainWindowStat = {
  domain: DomainRecord;
  mean: number;
  peak: number;
  machineCount: number;
};

type GridData = {
  bytes: Uint8Array;
  missingValue: number;
  metricCount: number;
  machineCount: number;
  binCount: number;
};

type AppState = {
  metricId: MetricId;
  timeWindow: [number, number];
  activeDomainId: string | null;
  selectedMachineIndex: number | null;
  machineFilterIndices: number[] | null;
};

const METRIC_ORDER: MetricId[] = ['cpu', 'memory', 'network', 'disk'];
const METRIC_META: Record<
  MetricId,
  { label: string; short: string; accent: string; description: string; interpolator: (value: number) => string }
> = {
  cpu: {
    label: 'CPU',
    short: 'CPU',
    accent: '#d66d2e',
    description: '刻画机器在 15 分钟窗口内的平均 CPU 利用率。',
    interpolator: d3.interpolateRgbBasis(['#f5ebde', '#f8c36f', '#e58e2e', '#992d0f'])
  },
  memory: {
    label: '内存',
    short: '内存',
    accent: '#178f8f',
    description: '刻画机器在 15 分钟窗口内的平均内存占用。',
    interpolator: d3.interpolateRgbBasis(['#eaf5f1', '#8ed7c9', '#2aa79d', '#0e5a55'])
  },
  network: {
    label: '网络',
    short: '网络',
    accent: '#4673df',
    description: '使用 net_in 与 net_out 的峰值，暴露网络热点集中窗口。',
    interpolator: d3.interpolateRgbBasis(['#edf2fb', '#9ec3ff', '#4c7de7', '#173a8c'])
  },
  disk: {
    label: '磁盘',
    short: '磁盘',
    accent: '#8c62e0',
    description: '刻画磁盘 IO 利用率，用来捕捉后台写入或批量读写活动。',
    interpolator: d3.interpolateRgbBasis(['#f3edff', '#cab4ff', '#9568e8', '#5e2db4'])
  }
};

const CHART_MARGINS = { top: 18, right: 20, bottom: 28, left: 48 };

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Unable to locate #app root node.');
}

const rootNode: HTMLDivElement = root;

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error';
  rootNode.innerHTML = `
    <div class="page-shell">
      <div class="error-panel">
        <strong>数据加载失败</strong>
        <p>${message}</p>
        <p>请先运行 <code>npm run data</code> 或 <code>npm run data:sample</code> 生成 <code>public/data</code>。</p>
      </div>
    </div>
  `;
});

async function bootstrap(): Promise<void> {
  const data = await loadInitialData();
  const app = new ClusterPulseApp(rootNode, data);
  await app.init();
}

async function loadInitialData(): Promise<AppData> {
  const [manifest, machines, summary, hotspots, domains] = await Promise.all([
    loadJson<Manifest>('data/manifest.json'),
    loadJson<MachinesFile>('data/machines.json'),
    loadJson<ClusterSummary>('data/cluster-summary.json'),
    loadJson<HotspotsFile>('data/hotspots.json'),
    loadJson<DomainsFile>('data/domains.json')
  ]);
  return { manifest, machines, summary, hotspots, domains };
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(resolveAsset(path));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function loadGrid(manifest: Manifest): Promise<GridData> {
  const response = await fetch(resolveAsset('data/machine-grid.bin'));
  if (!response.ok) {
    throw new Error(`Failed to fetch machine-grid.bin: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expectedLength = manifest.machineCount * manifest.binCount * METRIC_ORDER.length;
  if (bytes.length !== expectedLength) {
    throw new Error(`machine-grid.bin length mismatch. Expected ${expectedLength}, received ${bytes.length}.`);
  }
  return {
    bytes,
    missingValue: manifest.missingValue,
    metricCount: METRIC_ORDER.length,
    machineCount: manifest.machineCount,
    binCount: manifest.binCount
  };
}

function resolveAsset(path: string): string {
  return new URL(path, document.baseURI).toString();
}

function formatNumber(value: number): string {
  return d3.format(',')(Math.round(value));
}

function formatPercent(value: number): string {
  return `${d3.format('.1f')(value)}%`;
}

function clampWindow(window: [number, number], binCount: number): [number, number] {
  const start = Math.max(0, Math.min(binCount - 1, window[0]));
  const end = Math.max(start, Math.min(binCount - 1, window[1]));
  return [start, end];
}

function isFullWindow(window: [number, number], binCount: number): boolean {
  return window[0] === 0 && window[1] === binCount - 1;
}

function formatTime(valueSeconds: number): string {
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

function formatWindow(window: [number, number], binSeconds: number): string {
  const [startBin, endBin] = window;
  return `${formatTime(startBin * binSeconds)} - ${formatTime((endBin + 1) * binSeconds)}`;
}

function metricIndex(metricId: MetricId): number {
  return METRIC_ORDER.indexOf(metricId);
}

function gridValue(grid: GridData, metricId: MetricId, binIndex: number, machineIndex: number): number | null {
  const value =
    grid.bytes[metricIndex(metricId) * grid.binCount * grid.machineCount + binIndex * grid.machineCount + machineIndex];
  return value === grid.missingValue ? null : value;
}

function computeAverage(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

const TERM_EXPLANATIONS = {
  trace: '对生产集群运行状态按时间记录形成的原始轨迹数据。',
  failureDomain: '共享某类底层故障风险的一组机器。数据集中提供匿名化的两层故障域 failure_domain_1 和 failure_domain_2。',
  dag: '有向无环图，用来表示任务之间的依赖和执行先后关系。',
  machineMeta: '机器元数据表，包含机器编号、故障域、CPU 核数、内存规格和状态变化。',
  machineUsage: '机器利用率表，记录 CPU、内存、网络和磁盘等资源的时间序列使用情况。',
  treemap: '用矩形面积表示数值大小的图表，适合看占比，不适合精确排序。',
  brush: '在图上拖拽并框选连续范围的交互方式，这里主要用于选择时间窗口。',
  sample: '从真实原始数据中抽取的子集，用于降低网页体积并保持交互流畅。',
  full: '基于原始数据的完整聚合结果，覆盖范围更全，但文件体积更大。',
  githubPages: 'GitHub 提供的静态网站托管服务，这个项目从 main 分支的 docs 目录发布。',
  mbtaViz: '一个以波士顿地铁数据为主题的叙事式可视化案例，这里主要参考其页面组织方式。'
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTerm(label: string, description: string): string {
  return `<span class="term-hint" tabindex="0" data-term-label="${escapeHtml(label)}" data-term-tooltip="${escapeHtml(description)}">${escapeHtml(label)}</span>`;
}

class ClusterPulseApp {
  private readonly root: HTMLDivElement;
  private readonly data: AppData;
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

  constructor(rootNode: HTMLDivElement, data: AppData) {
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
    this.root.innerHTML = this.renderShell();
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

  private renderShell(): string {
    return `
      <div class="page-shell">
        <header class="site-header">
          <div class="site-badge">集群资源观察</div>
          <nav class="site-nav">
            <a href="#overview">概览</a>
            <a href="#pulse">热力图</a>
            <a href="#explorer">机器与故障域</a>
            <a href="#machine-detail">单机曲线</a>
            <a href="#methodology">方法说明</a>
          </nav>
        </header>

        <section id="overview" class="hero">
          <div class="eyebrow">Alibaba 2018 集群数据</div>
          <h1>集群压力判断</h1>
          <p class="hero-lead">
            这个页面聚焦机器级资源热点，回答生产集群里 CPU、内存、网络与磁盘压力何时抬头，
            热点是否集中在某些${renderTerm('故障域', TERM_EXPLANATIONS.failureDomain)}，以及单台机器在 8 天周期里的行为曲线如何变化。
          </p>
          <div class="hero-cta">
            <a href="#pulse">进入主图</a>
            <a href="#methodology">阅读方法说明</a>
          </div>
          <div class="hero-stats hero-meta" id="hero-stats"></div>
          <div class="hero-findings" id="hero-findings"></div>
          <div class="summary-ribbon-grid" id="summary-ribbons"></div>
          <div class="article-links" id="hero-highlights"></div>
        </section>
        <div class="section-bridge">
          <p>
            先从全局分布看起。把机器按故障域排列到同一条时间轴上之后，资源压力是零散抬升还是成片集中，会比单看均值更容易辨认。
          </p>
        </div>

        <section id="pulse" class="section">
          <div class="section-heading">
            <div class="eyebrow">资源热点</div>
            <h2>机器资源热点热力图</h2>
          </div>
          <div class="cluster-grid">
            <div class="section-panel">
              <div class="metric-controls">
                <div class="metric-buttons" id="metric-buttons"></div>
                <div class="metric-help" id="metric-help"></div>
              </div>
              <div class="heatmap-stage">
                <div class="heatmap-header">
                  <div class="heatmap-header-copy">
                    <strong id="heatmap-title">数据加载中…</strong>
                    <span id="heatmap-subtitle"></span>
                    <span class="window-inline" id="window-copy">热力图进入视口后将自动加载压缩矩阵。</span>
                  </div>
                  <div class="heatmap-actions">
                    <button class="domain-clear" id="show-all-machines" type="button">全部机器</button>
                    <button class="domain-clear" id="clear-heatmap-filter" type="button">清除主图筛选</button>
                  </div>
                </div>
                <div class="heatmap-canvas-wrap">
                  <div class="heatmap-stack">
                    <canvas id="heatmap-base" width="1200" height="720"></canvas>
                    <canvas id="heatmap-overlay" width="1200" height="720"></canvas>
                  </div>
                </div>
                <div class="brush-wrap">
                  <svg id="brush-chart"></svg>
                </div>
                <div class="legend-row">
                  <div>
                    <div class="legend-gradient" id="legend-gradient"></div>
                    <div class="legend-labels"><span>0%</span><span>50%</span><span>100%</span></div>
                  </div>
                  <div class="selection-badges" id="selection-badges"></div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <div class="section-bridge">
          <p>
            全局热力图能告诉我们热点出现在哪里，但还不能说明热点是由少数机器推动，还是在某个故障域中成簇出现。下一部分把当前窗口拆回机器与故障域。
          </p>
        </div>

        <section id="explorer" class="section">
          <div class="section-heading">
            <div class="eyebrow">机器与故障域</div>
            <h2>机器分布与故障域集中度</h2>
          </div>
          <div class="explorer-grid">
            <div class="metric-panel">
              <div class="metric-header">
                <div>
                  <span class="label">散点图</span>
                  <strong>CPU 与内存均值</strong>
                </div>
                <span id="scatter-caption"></span>
              </div>
              <svg id="scatter-chart" height="430"></svg>
            </div>
            <div class="metric-panel">
              <div class="metric-header">
                <div>
                  <span class="label">故障域</span>
                  <strong>热点集中度</strong>
                </div>
                <button class="domain-clear" id="clear-domain-filter" type="button">清除故障域过滤</button>
              </div>
              <svg id="domain-chart" height="430"></svg>
            </div>
          </div>
          <div class="explorer-detail-grid">
            <div class="metric-panel metric-panel-wide" id="machine-detail">
              <div class="machine-detail-title">
                <div>
                  <span class="label">选中机器</span>
                  <strong id="machine-title">等待加载</strong>
                </div>
                <span id="machine-subtitle"></span>
              </div>
              <p class="detail-copy">
                四条资源曲线共用同一时间轴。阴影区域对应当前窗口，便于把排行中的机器直接还原到完整 8 天曲线里。
              </p>
              <div class="small-multiples" id="machine-multiples"></div>
            </div>
            <div class="metric-panel">
              <div class="metric-header">
                <div>
                  <span class="label">热点排行</span>
                  <strong>当前窗口热点排行</strong>
                </div>
                <span id="table-caption"></span>
              </div>
              <div class="table-shell">
                <table class="ranking-table">
                  <thead>
                    <tr>
                      <th>机器</th>
                      <th>故障域</th>
                      <th>CPU</th>
                      <th>内存</th>
                      <th>主导热点</th>
                      <th>峰值</th>
                    </tr>
                  </thead>
                  <tbody id="ranking-table-body"></tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
        <div class="section-bridge">
          <p>
            当热点范围收缩到几台机器之后，还需要回到单机曲线确认它们的真实形态。最后一部分补充研究问题、设计取舍和数据处理方式，让图表与方法对应起来。
          </p>
        </div>

        <section id="methodology" class="section">
          <div class="section-heading">
            <div class="eyebrow">方法说明</div>
            <h2>问题、方法与数据来源</h2>
          </div>
          <article class="method-article" id="method-grid"></article>
        </section>
      </div>
    `;
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
    const button = this.root.querySelector<HTMLButtonElement>('#clear-heatmap-filter');
    const showAllMachinesButton = this.root.querySelector<HTMLButtonElement>('#show-all-machines');
    if (!button || !showAllMachinesButton) {
      return;
    }
    button.disabled = !this.hasActiveHeatmapFilter();
    showAllMachinesButton.disabled = !this.state.activeDomainId && !this.state.machineFilterIndices?.length;
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
    const observer = new IntersectionObserver(
      async (entries) => {
        const hit = entries.some((entry) => entry.isIntersecting);
        if (!hit) {
          return;
        }
        observer.disconnect();
        await this.ensureGridLoaded();
      },
      { rootMargin: '0px 0px 240px 0px' }
    );
    observer.observe(target);
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
    const container = this.root.querySelector<HTMLDivElement>('#metric-buttons');
    const help = this.root.querySelector<HTMLDivElement>('#metric-help');
    const legend = this.root.querySelector<HTMLDivElement>('#legend-gradient');
    if (!container || !help || !legend) {
      return;
    }

    if (!container.childElementCount) {
      container.innerHTML = this.data.manifest.metrics
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
      button.classList.toggle('is-active', button.dataset.metric === this.state.metricId);
    });

    help.textContent = METRIC_META[this.state.metricId].description;
    legend.style.background = `linear-gradient(90deg, ${Array.from({ length: 12 }, (_, index) =>
      METRIC_META[this.state.metricId].interpolator(index / 11)
    ).join(', ')})`;
  }

  private renderHero(): void {
    const heroStats = this.root.querySelector<HTMLDivElement>('#hero-stats');
    const heroFindings = this.root.querySelector<HTMLDivElement>('#hero-findings');
    const heroHighlights = this.root.querySelector<HTMLDivElement>('#hero-highlights');

    if (!heroStats || !heroFindings || !heroHighlights) {
      return;
    }

    const leadHighlight = this.data.hotspots.highlights[0];
    heroStats.innerHTML = [
      {
        label: '机器数',
        value: formatNumber(this.data.manifest.machineCount)
      },
      {
        label: '故障域',
        value: formatNumber(this.data.manifest.failureDomainCount)
      },
      {
        label: '处理记录',
        value: formatNumber(this.data.manifest.usageRowCount)
      },
      {
        label: '发布数据',
        value: this.data.manifest.subsetMode === 'sample' ? '真实子集' : '全量聚合'
      }
    ]
      .map((item) => `<span class="hero-stat"><span class="label">${item.label}</span>${item.value}</span>`)
      .join('');

    heroFindings.innerHTML = this.data.hotspots.findings
      .map(
        (finding, index) => `<p><span class="inline-label">发现 ${index + 1}</span>${finding}</p>`
      )
      .join('');

    if (leadHighlight) {
      heroHighlights.innerHTML = `
        <a class="annotation-link" href="#pulse" data-hotspot-id="${leadHighlight.id}">
          从 ${leadHighlight.title} 开始：${leadHighlight.summary}
        </a>
      `;
    }
  }

  private renderSummaryRibbons(): void {
    const container = this.root.querySelector<HTMLDivElement>('#summary-ribbons');
    if (!container) {
      return;
    }

    container.innerHTML = this.data.manifest.metrics
      .map(
        (metric) => `
          <div class="mini-metric-card">
            <span class="label">${METRIC_META[metric.id].label}</span>
            <svg data-ribbon="${metric.id}" viewBox="0 0 220 48" preserveAspectRatio="none"></svg>
            <div class="metric-summary-value">${formatPercent(
          d3.max(this.data.summary.metrics[metric.id].p99) ?? 0
        )} P99 峰值</div>
          </div>
        `
      )
      .join('');

    this.data.manifest.metrics.forEach((metric) => {
      const svg = container.querySelector<SVGSVGElement>(`svg[data-ribbon="${metric.id}"]`);
      if (!svg) {
        return;
      }
      const values = this.data.summary.metrics[metric.id].p90;
      const width = 220;
      const height = 48;
      const x = d3.scaleLinear().domain([0, values.length - 1]).range([0, width]);
      const y = d3.scaleLinear().domain([0, 100]).range([height, 4]);
      const area = d3
        .area<number>()
        .x((_, index) => x(index))
        .y0(height)
        .y1((value) => y(value))
        .curve(d3.curveMonotoneX);
      const line = d3
        .line<number>()
        .x((_, index) => x(index))
        .y((value) => y(value))
        .curve(d3.curveMonotoneX);

      const selection = d3.select(svg);
      selection.selectAll('*').remove();
      selection
        .append('path')
        .attr('d', area(values) ?? '')
        .attr('fill', `${METRIC_META[metric.id].accent}22`);
      selection
        .append('path')
        .attr('d', line(values) ?? '')
        .attr('fill', 'none')
        .attr('stroke', METRIC_META[metric.id].accent)
        .attr('stroke-width', 2.4);
    });
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
    return this.state.machineFilterIndices?.join(',') ?? 'all';
  }

  private normalizeMachineFilter(): void {
    if (!this.state.machineFilterIndices?.length) {
      this.state.machineFilterIndices = null;
      return;
    }
    const visibleMachineSet = new Set(this.getVisibleMachineIndices());
    const normalized = this.state.machineFilterIndices.filter((machineIndex) => visibleMachineSet.has(machineIndex));
    if (!normalized.length || normalized.length === this.getVisibleMachineIndices().length) {
      this.state.machineFilterIndices = null;
      return;
    }
    this.state.machineFilterIndices = normalized;
  }

  private getFilteredMachineIndices(): number[] {
    const visibleMachineIndices = this.getVisibleMachineIndices();
    if (!this.state.machineFilterIndices?.length) {
      return visibleMachineIndices;
    }
    const visibleMachineSet = new Set(visibleMachineIndices);
    const filtered = this.state.machineFilterIndices.filter((machineIndex) => visibleMachineSet.has(machineIndex));
    return filtered.length ? filtered : visibleMachineIndices;
  }

  private renderSelectionBadges(): void {
    const container = this.root.querySelector<HTMLDivElement>('#selection-badges');
    if (!container) {
      return;
    }
    const visibleMachineCount = this.getVisibleMachineIndices().length;
    const filteredMachineCount = this.getFilteredMachineIndices().length;
    const badges = [
      `指标：${METRIC_META[this.state.metricId].label}`,
      `窗口：${formatWindow(this.state.timeWindow, this.data.manifest.binSeconds)}`,
      `机器：${filteredMachineCount}/${visibleMachineCount}`,
      `范围：${this.state.activeDomainId ? `FD-${this.state.activeDomainId}` : '全部故障域'}`
    ];
    container.innerHTML = badges.map((text) => `<span>${text}</span>`).join('');
  }

  private getVisibleMachineIndices(): number[] {
    const cacheKey = `${this.state.metricId}:${this.state.activeDomainId ?? 'all'}`;
    if (this.cachedVisibleIndicesKey === cacheKey) {
      return this.cachedVisibleMachineIndices;
    }
    this.cachedVisibleIndicesKey = cacheKey;
    let allVisible = !this.state.activeDomainId
      ? this.data.machines.machines.map((machine) => machine.index)
      : (this.data.domains.domains.find((domain) => domain.domainId === this.state.activeDomainId)?.machineIndices ?? []);

    const metricPeaks = this.getMachineMetricPeaks()[this.state.metricId];
    allVisible = [...allVisible].sort((left, right) => {
      const leftPeak = metricPeaks[left] ?? 0;
      const rightPeak = metricPeaks[right] ?? 0;
      if (rightPeak !== leftPeak) {
        return rightPeak - leftPeak;
      }
      const leftScore = this.data.machines.machines[left]?.globalPeakScore ?? 0;
      const rightScore = this.data.machines.machines[right]?.globalPeakScore ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left - right;
    });

    if (allVisible.length > 48) {
      this.cachedVisibleMachineIndices = allVisible.slice(0, 48);
      return this.cachedVisibleMachineIndices;
    }
    this.cachedVisibleMachineIndices = allVisible;
    return this.cachedVisibleMachineIndices;
  }

  private getMachineMetricPeaks(): Record<MetricId, number[]> {
    if (this.machineMetricPeaks) {
      return this.machineMetricPeaks;
    }
    const machineCount = this.data.manifest.machineCount;
    const peaks: Record<MetricId, number[]> = {
      cpu: new Array(machineCount).fill(0),
      memory: new Array(machineCount).fill(0),
      network: new Array(machineCount).fill(0),
      disk: new Array(machineCount).fill(0)
    };
    if (!this.grid) {
      return peaks;
    }
    METRIC_ORDER.forEach((metricId) => {
      for (let machineIndex = 0; machineIndex < machineCount; machineIndex += 1) {
        let peak = 0;
        for (let binIndex = 0; binIndex < this.data.manifest.binCount; binIndex += 1) {
          peak = Math.max(peak, gridValue(this.grid as GridData, metricId, binIndex, machineIndex) ?? 0);
        }
        peaks[metricId][machineIndex] = peak;
      }
    });
    this.machineMetricPeaks = peaks;
    return peaks;
  }

  private getWindowMachineStats(): WindowMachineStat[] {
    if (!this.grid) {
      return [];
    }
    const cacheKey = `${this.state.metricId}:${this.state.activeDomainId ?? 'all'}:${this.state.timeWindow[0]}:${this.state.timeWindow[1]}:${this.getMachineFilterKey()}`;
    if (this.cachedWindowStatsKey === cacheKey) {
      return this.cachedWindowStats;
    }
    const [startBin, endBin] = this.state.timeWindow;
    const visibleIndices = new Set(this.getFilteredMachineIndices());
    const stats: WindowMachineStat[] = [];

    this.data.machines.machines.forEach((machine) => {
      if (!visibleIndices.has(machine.index)) {
        return;
      }
      const valuesByMetric: Record<MetricId, number[]> = {
        cpu: [],
        memory: [],
        network: [],
        disk: []
      };
      const peaksByMetric: Record<MetricId, number> = {
        cpu: 0,
        memory: 0,
        network: 0,
        disk: 0
      };
      let peakMetric: MetricId = 'cpu';
      let peakValue = -1;

      for (let binIndex = startBin; binIndex <= endBin; binIndex += 1) {
        METRIC_ORDER.forEach((metricId) => {
          const value = gridValue(this.grid as GridData, metricId, binIndex, machine.index);
          if (value === null) {
            return;
          }
          valuesByMetric[metricId].push(value);
          peaksByMetric[metricId] = Math.max(peaksByMetric[metricId], value);
          if (value > peakValue) {
            peakValue = value;
            peakMetric = metricId;
          }
        });
      }

      const allCounts = METRIC_ORDER.reduce((sum, metricId) => sum + valuesByMetric[metricId].length, 0);
      if (allCounts === 0) {
        return;
      }
      stats.push({
        machineIndex: machine.index,
        machine,
        domainId: machine.failureDomain1,
        averages: {
          cpu: computeAverage(valuesByMetric.cpu),
          memory: computeAverage(valuesByMetric.memory),
          network: computeAverage(valuesByMetric.network),
          disk: computeAverage(valuesByMetric.disk)
        },
        counts: {
          cpu: valuesByMetric.cpu.length,
          memory: valuesByMetric.memory.length,
          network: valuesByMetric.network.length,
          disk: valuesByMetric.disk.length
        },
        peaks: peaksByMetric,
        peakMetric,
        windowPeak: Math.max(peakValue, 0),
        peakValue
      });
    });

    this.cachedWindowStatsKey = cacheKey;
    const selectedMetric = this.state.metricId;
    this.cachedWindowStats = stats.sort((left, right) => {
      const peakDelta = right.peaks[selectedMetric] - left.peaks[selectedMetric];
      if (peakDelta !== 0) {
        return peakDelta;
      }
      const averageDelta = right.averages[selectedMetric] - left.averages[selectedMetric];
      if (averageDelta !== 0) {
        return averageDelta;
      }
      return right.windowPeak - left.windowPeak;
    });
    return this.cachedWindowStats;
  }

  private renderWindowCard(stats: WindowMachineStat[]): void {
    const heatmapTitle = this.root.querySelector<HTMLElement>('#heatmap-title');
    const heatmapSubtitle = this.root.querySelector<HTMLElement>('#heatmap-subtitle');
    const windowCopy = this.root.querySelector<HTMLElement>('#window-copy');
    const top = stats[0];

    if (!heatmapTitle || !heatmapSubtitle || !windowCopy || !top) {
      return;
    }

    heatmapTitle.textContent = `${METRIC_META[this.state.metricId].label} 热力图`;
    heatmapSubtitle.textContent = `${this.getFilteredMachineIndices().length}/${this.getVisibleMachineIndices().length} 台机器 · ${formatWindow(
      this.state.timeWindow,
      this.data.manifest.binSeconds
    )}`;
    windowCopy.textContent = `当前窗口：FD-${top.domainId} 的 ${top.machine.machineId} 在 ${METRIC_META[this.state.metricId].label} 指标上最突出，峰值 ${formatPercent(
      top.peaks[this.state.metricId]
    )}，窗口均值 ${formatPercent(top.averages[this.state.metricId])}。`;
  }

  private drawHeatmapBase(): void {
    if (!this.grid || !this.heatmapCanvas) {
      return;
    }

    const visibleMachineIndices = this.getVisibleMachineIndices();
    const srcWidth = this.data.manifest.binCount;
    const srcHeight = Math.max(visibleMachineIndices.length, 1);
    const cacheKey = `${this.state.metricId}:${this.state.activeDomainId ?? 'all'}`;
    let offscreen = this.heatmapBaseCache.get(cacheKey);

    if (!offscreen) {
      offscreen = document.createElement('canvas');
      offscreen.width = srcWidth;
      offscreen.height = srcHeight;
      const offContext = offscreen.getContext('2d');
      if (!offContext) {
        return;
      }
      const image = offContext.createImageData(srcWidth, srcHeight);
      const palette = this.getPalette(this.state.metricId);

      visibleMachineIndices.forEach((machineIndex, row) => {
        for (let binIndex = 0; binIndex < srcWidth; binIndex += 1) {
          const value = gridValue(this.grid as GridData, this.state.metricId, binIndex, machineIndex);
          const pixelIndex = (row * srcWidth + binIndex) * 4;
          const color = value === null ? [235, 238, 242, 255] : palette[value];
          image.data[pixelIndex] = color[0];
          image.data[pixelIndex + 1] = color[1];
          image.data[pixelIndex + 2] = color[2];
          image.data[pixelIndex + 3] = color[3];
        }
      });

      offContext.putImageData(image, 0, 0);
      this.heatmapBaseCache.set(cacheKey, offscreen);
    }

    const canvas = this.heatmapCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  }

  private drawHeatmapOverlay(): void {
    if (!this.heatmapOverlayCanvas) {
      return;
    }

    const canvas = this.heatmapOverlayCanvas;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);

    const visibleMachineIndices = this.getVisibleMachineIndices();
    const activeSelection = this.heatmapDragging ? this.getDraftHeatmapSelection() : this.getCommittedHeatmapSelection();

    if (activeSelection) {
      this.drawHeatmapSelectionMask(context, canvas, activeSelection);
    }

    const selected = this.state.selectedMachineIndex;
    if (selected !== null) {
      const row = visibleMachineIndices.indexOf(selected);
      if (row >= 0) {
        const rowHeight = canvas.height / Math.max(visibleMachineIndices.length, 1);
        context.strokeStyle = 'rgba(22, 61, 117, 0.96)';
        context.lineWidth = 2;
        context.strokeRect(0, row * rowHeight, canvas.width, rowHeight);
      }
    }

    if (this.hoverMachineIndex !== null && !this.heatmapDragging) {
      const hoverRow = visibleMachineIndices.indexOf(this.hoverMachineIndex);
      if (hoverRow >= 0) {
        const rowHeight = canvas.height / Math.max(visibleMachineIndices.length, 1);
        context.fillStyle = 'rgba(22, 61, 117, 0.12)';
        context.fillRect(0, hoverRow * rowHeight, canvas.width, rowHeight);
      }
    }
  }

  private getCommittedHeatmapSelection():
    | { startBin: number; endBin: number; startRow: number; endRow: number }
    | null {
    const visibleMachineIndices = this.getVisibleMachineIndices();
    if (!visibleMachineIndices.length) {
      return null;
    }
    const hasTimeFilter = !isFullWindow(this.state.timeWindow, this.data.manifest.binCount);
    const filteredMachineIndices = this.getFilteredMachineIndices();
    const hasMachineFilter = filteredMachineIndices.length !== visibleMachineIndices.length;
    if (!hasTimeFilter && !hasMachineFilter) {
      return null;
    }
    const rowPositions = hasMachineFilter
      ? filteredMachineIndices
        .map((machineIndex) => visibleMachineIndices.indexOf(machineIndex))
        .filter((rowIndex) => rowIndex >= 0)
      : [0, visibleMachineIndices.length - 1];
    if (!rowPositions.length) {
      return null;
    }
    return {
      startBin: hasTimeFilter ? this.state.timeWindow[0] : 0,
      endBin: hasTimeFilter ? this.state.timeWindow[1] : this.data.manifest.binCount - 1,
      startRow: Math.min(...rowPositions),
      endRow: Math.max(...rowPositions)
    };
  }

  private getDraftHeatmapSelection():
    | { startBin: number; endBin: number; startRow: number; endRow: number }
    | null {
    if (!this.heatmapDragging || !this.heatmapDragStart || !this.heatmapDragCurrent) {
      return null;
    }
    return {
      startBin: Math.min(this.heatmapDragStart.binIndex, this.heatmapDragCurrent.binIndex),
      endBin: Math.max(this.heatmapDragStart.binIndex, this.heatmapDragCurrent.binIndex),
      startRow: Math.min(this.heatmapDragStart.rowIndex, this.heatmapDragCurrent.rowIndex),
      endRow: Math.max(this.heatmapDragStart.rowIndex, this.heatmapDragCurrent.rowIndex)
    };
  }

  private drawHeatmapSelectionMask(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    selection: { startBin: number; endBin: number; startRow: number; endRow: number }
  ): void {
    const visibleMachineCount = Math.max(this.getVisibleMachineIndices().length, 1);
    const x1 = (selection.startBin / this.data.manifest.binCount) * canvas.width;
    const x2 = ((selection.endBin + 1) / this.data.manifest.binCount) * canvas.width;
    const y1 = (selection.startRow / visibleMachineCount) * canvas.height;
    const y2 = ((selection.endRow + 1) / visibleMachineCount) * canvas.height;

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

  private requestOverlayDraw(): void {
    if (this.overlayFrameHandle) {
      return;
    }
    this.overlayFrameHandle = window.requestAnimationFrame(() => {
      this.overlayFrameHandle = 0;
      this.drawHeatmapOverlay();
    });
  }

  private locateHeatmapCell(event: MouseEvent): { machineIndex: number; binIndex: number; rowIndex: number } | null {
    if (!this.heatmapOverlayCanvas) {
      return null;
    }
    const rect = this.heatmapOverlayCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return null;
    }
    const visibleMachineIndices = this.getVisibleMachineIndices();
    if (!visibleMachineIndices.length) {
      return null;
    }
    const binIndex = Math.max(0, Math.min(this.data.manifest.binCount - 1, Math.floor((x / rect.width) * this.data.manifest.binCount)));
    const rowIndex = Math.max(0, Math.min(visibleMachineIndices.length - 1, Math.floor((y / rect.height) * visibleMachineIndices.length)));
    return { machineIndex: visibleMachineIndices[rowIndex], binIndex, rowIndex };
  }

  private renderBrushChart(): void {
    const svgNode = this.root.querySelector<SVGSVGElement>('#brush-chart');
    if (!svgNode) {
      return;
    }
    const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 900;
    const height = 86;
    const svg = d3.select(svgNode);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const summary = this.data.summary.metrics[this.state.metricId].p90;
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

    svg
      .append('path')
      .attr('d', area(summary) ?? '')
      .attr('fill', `${METRIC_META[this.state.metricId].accent}22`);
    svg
      .append('path')
      .attr('d', line(summary) ?? '')
      .attr('fill', 'none')
      .attr('stroke', METRIC_META[this.state.metricId].accent)
      .attr('stroke-width', 2.6);

    const axis = d3.axisBottom<number>(x).tickValues([0, 192, 384, 576, 767]).tickFormat((value) => formatTime(value * this.data.manifest.binSeconds));
    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${height - CHART_MARGINS.bottom})`)
      .call(axis);

    const brush = d3
      .brushX()
      .extent([
        [CHART_MARGINS.left, CHART_MARGINS.top],
        [width - CHART_MARGINS.right, height - CHART_MARGINS.bottom]
      ])
      .on('end', (event) => {
        if (this.brushSuppressed || !event.sourceEvent || !event.selection) {
          return;
        }
        const [left, right] = event.selection as [number, number];
        const start = Math.max(0, Math.floor(x.invert(left)));
        const end = Math.max(start, Math.min(this.data.manifest.binCount - 1, Math.ceil(x.invert(right))));
        this.state.timeWindow = [start, end];
        this.renderInteractiveViews();
      });

    const brushGroup = svg.append('g');
    brushGroup.call(brush as never);
    this.brushSuppressed = true;
    brushGroup.call(brush.move as never, [x(this.state.timeWindow[0]), x(this.state.timeWindow[1] + 1)]);
    this.brushSuppressed = false;
  }

  private renderScatter(stats: WindowMachineStat[]): void {
    const svgNode = this.root.querySelector<SVGSVGElement>('#scatter-chart');
    const caption = this.root.querySelector<HTMLElement>('#scatter-caption');
    if (!svgNode || !this.grid || !caption) {
      return;
    }

    const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 960;
    const height = 430;
    const svg = d3.select(svgNode);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const x = d3.scaleLinear().domain([0, 100]).range([60, width - 28]);
    const y = d3.scaleLinear().domain([0, 100]).range([height - 44, 18]);
    const radius = d3.scaleSqrt<number, number>().domain([0, 100]).range([4, 18]);

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${height - 44})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((value) => `${value}%`));

    svg.append('g').attr('class', 'axis').attr('transform', 'translate(60,0)').call(d3.axisLeft(y).ticks(6).tickFormat((value) => `${value}%`));

    svg
      .append('text')
      .attr('x', width - 28)
      .attr('y', height - 8)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--muted)')
      .attr('font-size', 12)
      .text('CPU 均值');

    svg
      .append('text')
      .attr('x', 12)
      .attr('y', 18)
      .attr('fill', 'var(--muted)')
      .attr('font-size', 12)
      .text('内存均值');

    svg
      .append('g')
      .selectAll('circle')
      .data(stats.slice(0, 240))
      .join('circle')
      .attr('cx', (d) => x(d.averages.cpu))
      .attr('cy', (d) => y(d.averages.memory))
      .attr('r', (d) => radius(d.peaks[this.state.metricId]))
      .attr('fill', `${METRIC_META[this.state.metricId].accent}bb`)
      .attr('stroke', (d) => (d.machineIndex === this.state.selectedMachineIndex ? '#231913' : 'rgba(35, 25, 19, 0.2)'))
      .attr('stroke-width', (d) => (d.machineIndex === this.state.selectedMachineIndex ? 2.4 : 1))
      .attr('opacity', 0.88)
      .style('cursor', 'pointer')
      .on('mouseenter', (event, datum) => {
        this.showTooltip(
          event.clientX,
          event.clientY,
          `<strong>${datum.machine.machineId}</strong><br />FD-${datum.domainId}<br />CPU ${formatPercent(
            datum.averages.cpu
          )} · 内存 ${formatPercent(datum.averages.memory)}<br />${METRIC_META[this.state.metricId].label} 峰值 ${formatPercent(
            datum.peaks[this.state.metricId]
          )}`
        );
      })
      .on('mouseleave', () => this.hideTooltip())
      .on('click', (_, datum) => {
        this.state.selectedMachineIndex = datum.machineIndex;
        this.renderInteractiveViews();
      });

    caption.textContent = `${stats.length} 台机器参与当前窗口分析，圆点大小表示 ${METRIC_META[this.state.metricId].label} 峰值`;
  }

  private renderDomainBars(machineStats: WindowMachineStat[]): void {
    const svgNode = this.root.querySelector<SVGSVGElement>('#domain-chart');
    if (!svgNode || !this.grid) {
      return;
    }
    const width = svgNode.clientWidth || svgNode.parentElement?.clientWidth || 520;
    const height = 430;
    const svg = d3.select(svgNode);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const stats = this.computeDomainWindowStats(machineStats).slice(0, 10);
    const x = d3.scaleLinear().domain([0, d3.max(stats, (item) => item.peak) ?? 100]).nice().range([110, width - 24]);
    const y = d3.scaleBand<string>().domain(stats.map((item) => item.domain.domainId)).range([18, height - 36]).padding(0.16);

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0, ${height - 36})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((value) => `${value}%`));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', 'translate(110, 0)')
      .call(d3.axisLeft(y).tickFormat((value) => `FD-${value}`));

    svg
      .append('g')
      .selectAll('rect')
      .data(stats)
      .join('rect')
      .attr('class', (d) => `domain-bar ${this.state.activeDomainId === d.domain.domainId ? 'is-active' : ''}`)
      .attr('x', x(0))
      .attr('y', (d) => y(d.domain.domainId) ?? 0)
      .attr('width', (d) => x(d.peak) - x(0))
      .attr('height', y.bandwidth())
      .attr('rx', 10)
      .attr('fill', (d) =>
        this.state.activeDomainId === d.domain.domainId
          ? METRIC_META[this.state.metricId].accent
          : `${METRIC_META[d.domain.peakMetric].accent}bb`
      )
      .on('mouseenter', (event, datum) => {
        this.showTooltip(
          event.clientX,
          event.clientY,
          `<strong>FD-${datum.domain.domainId}</strong><br />当前 ${METRIC_META[this.state.metricId].label} 峰值 ${formatPercent(
            datum.peak
          )}<br />机器数 ${datum.machineCount}`
        );
      })
      .on('mouseleave', () => this.hideTooltip())
      .on('click', (_, datum) => {
        this.state.activeDomainId = this.state.activeDomainId === datum.domain.domainId ? null : datum.domain.domainId;
        this.renderInteractiveViews();
      });
  }

  private computeDomainWindowStats(machineStats: WindowMachineStat[]): DomainWindowStat[] {
    const byDomain = d3.group(machineStats, (stat) => stat.domainId);
    return this.data.domains.domains
      .map((domain) => {
        const members = byDomain.get(domain.domainId) ?? [];
        const values = members.map((member) => member.averages[this.state.metricId]);
        const peaks = members.map((member) => member.peaks[this.state.metricId]);
        return {
          domain,
          mean: computeAverage(values),
          peak: d3.max(peaks) ?? 0,
          machineCount: members.length
        };
      })
      .filter((domain) => domain.machineCount > 0)
      .sort((left, right) => right.peak - left.peak || right.mean - left.mean);
  }

  private renderRankingTable(stats: WindowMachineStat[]): void {
    const body = this.root.querySelector<HTMLTableSectionElement>('#ranking-table-body');
    const caption = this.root.querySelector<HTMLElement>('#table-caption');
    if (!body || !caption) {
      return;
    }

    caption.textContent = `${stats.length} 台机器中按 ${METRIC_META[this.state.metricId].label} 峰值排序`;
    body.innerHTML = stats
      .slice(0, 10)
      .map(
        (stat) => `
          <tr class="${stat.machineIndex === this.state.selectedMachineIndex ? 'is-selected' : ''}" data-machine-index="${stat.machineIndex}">
            <td>${stat.machine.machineId}</td>
            <td>FD-${stat.domainId}</td>
            <td>${formatPercent(stat.averages.cpu)}</td>
            <td>${formatPercent(stat.averages.memory)}</td>
            <td>${METRIC_META[this.state.metricId].label}</td>
            <td>${formatPercent(stat.peaks[this.state.metricId])}</td>
          </tr>
        `
      )
      .join('');

    body.querySelectorAll<HTMLTableRowElement>('tr[data-machine-index]').forEach((row) => {
      row.addEventListener('click', () => {
        const index = Number(row.dataset.machineIndex);
        this.state.selectedMachineIndex = index;
        this.renderInteractiveViews();
      });
    });
  }

  private renderMachineDetail(): void {
    const title = this.root.querySelector<HTMLElement>('#machine-title');
    const subtitle = this.root.querySelector<HTMLElement>('#machine-subtitle');
    const container = this.root.querySelector<HTMLDivElement>('#machine-multiples');
    if (!title || !subtitle || !container || !this.grid) {
      return;
    }

    const machine = this.data.machines.machines.find((item) => item.index === this.state.selectedMachineIndex) ?? this.data.machines.machines[0];
    this.state.selectedMachineIndex = machine.index;

    title.textContent = `${machine.machineId} · FD-${machine.failureDomain1}`;
    subtitle.textContent = `CPU ${machine.cpuNum} 核 · 内存 ${machine.memSize} 归一化单位 · 状态 ${machine.status}`;

    container.innerHTML = METRIC_ORDER.map((metricId) => `<div class="small-metric"><span class="label">${METRIC_META[metricId].label}</span><svg data-machine-metric="${metricId}"></svg></div>`).join('');

    METRIC_ORDER.forEach((metricId) => {
      const svgNode = container.querySelector<SVGSVGElement>(`svg[data-machine-metric="${metricId}"]`);
      if (!svgNode) {
        return;
      }
      const width = svgNode.clientWidth || container.clientWidth || 920;
      const height = 120;
      const svg = d3.select(svgNode);
      svg.selectAll('*').remove();
      svg.attr('viewBox', `0 0 ${width} ${height}`);

      const values = Array.from({ length: this.data.manifest.binCount }, (_, index) => gridValue(this.grid as GridData, metricId, index, machine.index) ?? 0);
      const x = d3.scaleLinear().domain([0, values.length - 1]).range([48, width - 18]);
      const y = d3.scaleLinear().domain([0, 100]).range([height - 24, 12]);
      const line = d3
        .line<number>()
        .x((_, index) => x(index))
        .y((value) => y(value))
        .curve(d3.curveMonotoneX);

      const [windowStart, windowEnd] = this.state.timeWindow;
      svg
        .append('rect')
        .attr('x', x(windowStart))
        .attr('y', 10)
        .attr('width', x(windowEnd + 1) - x(windowStart))
        .attr('height', height - 32)
        .attr('fill', `${METRIC_META[metricId].accent}18`);

      svg
        .append('path')
        .attr('d', line(values) ?? '')
        .attr('fill', 'none')
        .attr('stroke', METRIC_META[metricId].accent)
        .attr('stroke-width', 2.2);

      svg
        .append('g')
        .attr('class', 'axis')
        .attr('transform', `translate(0, ${height - 24})`)
        .call(
          d3
            .axisBottom(x)
            .tickValues([0, 192, 384, 576, 767])
            .tickFormat((value) => formatTime(Number(value) * this.data.manifest.binSeconds))
        );

      svg
        .append('g')
        .attr('class', 'axis')
        .attr('transform', 'translate(48,0)')
        .call(d3.axisLeft(y).ticks(4).tickFormat((value) => `${value}%`));
    });
  }

  private renderMethodology(): void {
    const container = this.root.querySelector<HTMLElement>('#method-grid');
    if (!container) {
      return;
    }

    const leadHighlight = this.data.hotspots.highlights[0];
    container.innerHTML = `
      <h3>可视化方案要解答什么问题</h3>
      <p>
        这个可视化围绕一个具体而可检验的问题展开：在 Alibaba 2018 集群的 8 天 ${renderTerm('trace', TERM_EXPLANATIONS.trace)} 中，CPU、内存、网络与磁盘压力何时出现，
        热点是零散分布在少数机器上，还是集中在某些${renderTerm('故障域', TERM_EXPLANATIONS.failureDomain)}中，以及被选中的机器在完整周期里究竟表现为短时尖峰、持续高负载，
        还是多种资源同时抬升。页面没有试图同时覆盖容器、批处理任务与调度 ${renderTerm('DAG', TERM_EXPLANATIONS.dag)}，而是先把机器级资源热点这一条分析链讲清楚。
      </p>
      <p>
        因此，主热力图负责回答“热点发生在什么时候、落在哪些机器上”，中段的散点图与故障域条形图负责回答“当前窗口里的热点是否集中成簇”，
        下方单机四条资源曲线则负责回答“某台机器的热点究竟是什么形态”。三个视图对应的是同一个问题的全局、局部和解释三个层次。
      </p>
      <h3>设计决策依据、替代方案与最终取舍</h3>
      <p>
        页面结构采用文章式布局，先提出问题，再进入图表，最后在页面结尾集中交代方法说明。这一结构参考了 ${renderTerm('MBTA Viz', TERM_EXPLANATIONS.mbtaViz)} 的长文式可视化组织方式，
        因为本项目更像一篇带交互的分析文章，而不是一组可以独立阅读的监控卡片。相比把文字解释全部塞进侧栏或提示框，段落式说明更适合交代研究问题、
        设计理由和外部引用，也更符合课程要求中“说明文档可与作品置于同一页面”的提交方式。
      </p>
      <p>
        主图最终选择热力图，而没有采用多折线、堆叠面积图或汇总柱图。原因是这个任务必须同时保留连续时间轴和按故障域排序后的机器分布；
        若改用折线，机器数量一多就会严重遮挡；若只做汇总柱图，虽然便于比较均值，却会丢失热点是“成片出现”还是“局部闪现”的结构信息。
        中段采用 CPU 对内存的散点图，是为了把当前时间窗内的机器分布投影到一个便于比较的位置图上，再用点大小编码当前指标峰值，从而区分
        “均值偏高”和“峰值突刺”两类不同状态。故障域部分使用条形图而不是 ${renderTerm('treemap', TERM_EXPLANATIONS.treemap)} 或饼图，是因为这里更关心排序与集中度，而不是面积占比。
      </p>
      <p>
        交互上最终保留了指标切换、主图框选、故障域过滤和机器点击四类操作。也考虑过只保留底部时间轴 ${renderTerm('brush', TERM_EXPLANATIONS.brush)} 的方案，但那样无法直接在主图里同时选择
        时间与机器范围；也考虑过更复杂的筛选菜单，但会打断阅读路径。最终版本选择在主热力图上直接框选，再让散点图、排行表和单机曲线同步联动，
        以减少界面跳转成本。${leadHighlight ? `页面默认聚焦 ${leadHighlight.title}，也是为了让首次进入页面的读者立即看到一个真实的热点窗口。` : '页面默认从全局最强热点窗口开始，避免首屏停留在过于平缓的状态。'}
      </p>
      <h3>外部资源引用</h3>
      <p>
        数据源来自 Alibaba Cluster Trace 2018，本项目实际使用的是其中的 ${renderTerm('machine_meta', TERM_EXPLANATIONS.machineMeta)} 与 ${renderTerm('machine_usage', TERM_EXPLANATIONS.machineUsage)} 两张表。页面中的静态数据并非手工构造示例，
        而是由脚本下载原始数据后按 15 分钟时间窗聚合生成，再部署到 ${renderTerm('GitHub Pages', TERM_EXPLANATIONS.githubPages)}。除数据源外，页面的叙事结构和长文式排版参考了 ${renderTerm('MBTA Viz', TERM_EXPLANATIONS.mbtaViz)}；
        本项目没有直接复用其代码和图形，而是借用了其“以文章节奏组织交互可视化”的写法。
      </p>
      <p class="source-inline">
        参考资料：
        <a href="${this.data.manifest.sources.assignmentUrl}" target="_blank" rel="noreferrer">课程作业要求</a>
        <span> / </span>
        <a href="${this.data.manifest.sources.datasetDocsUrl}" target="_blank" rel="noreferrer">Alibaba trace 文档</a>
        <span> / </span>
        <a href="${this.data.manifest.sources.datasetSchemaUrl}" target="_blank" rel="noreferrer">Alibaba schema</a>
        <span> / </span>
        <a href="https://mbtaviz.github.io/" target="_blank" rel="noreferrer">MBTA Viz</a>
      </p>
      <h3>开发流程概述与评述</h3>
      <p>
        当前版本按单人项目推进，数据处理、前端实现、交互联动、样式调整与 GitHub Pages 部署均由同一人完成。如果按工时估算，
        从方案确定、数据脚本编写、前端实现到上线整理大约花费 25 到 35 小时，其中最耗时的并不是基础页面搭建，而是两类工作：
        一类是把原始 trace 清洗并压缩成适合静态网页加载的结构，另一类是反复调整主热力图和联动交互，使页面在 GitHub Pages 环境下既能显示真实数据，
        又不至于过于卡顿。
      </p>
      <p>
        开发过程前期主要时间投入在数据管线和指标定义上，例如如何处理缺失值、如何定义热点、如何在 ${renderTerm('sample', TERM_EXPLANATIONS.sample)} 与 ${renderTerm('full', TERM_EXPLANATIONS.full)} 两种模式之间共享统一输出接口。
        中后期则主要花在交互和版式迭代，包括主图框选、故障域过滤、单机曲线联动，以及把页面从仪表盘式布局收敛成文章式结构。回头看，最关键的取舍
        是先缩小问题范围，只做机器级资源热点，而不是把容器、批处理任务和调度关系同时塞进一个页面里；这个取舍让页面能够围绕同一个问题形成完整叙事，
        也让说明文档与图表之间保持一一对应。
      </p>
    `;
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
