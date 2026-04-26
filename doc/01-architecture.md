# 架构说明

本文档描述 Cluster Pulse 的整体系统架构、前端渲染模式、数据流和核心设计决策。

## 系统全景

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据源层                                   │
│  Alibaba Cluster Trace 2018 (machine_meta + machine_usage)       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        数据管道 (Python 3)                        │
│  download_alibaba.sh → build_data.py → verify_data.py            │
│  输出: JSON 元数据 + machine-grid.bin 压缩矩阵                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        前端应用 (浏览器)                           │
│  Vite 多页面: 主页（三象限可视化）+ 方法说明独立页面               │
│  状态层: Pinia store · 视图层: Vue 面板 + D3 命令式绘图           │
│  部署目标: GitHub Pages (docs/ 目录)                              │
└─────────────────────────────────────────────────────────────────┘
```

整个系统是无后端架构：原始 trace 数据经 Python 脚本离线预处理后，生成一组静态文件（JSON + 二进制），由前端直接加载并渲染。

## 前端架构：三层结构

前端采用 **Pinia 状态层 + Vue 面板组件 + D3 绘图函数** 的三层架构。

### 状态层（Pinia）

[useVisualizationStore](../src/stores/visualization.ts) 是单一事实来源，使用 Pinia setup 风格定义。包含：

- **State 字段**（沿用旧 `AppState` 概念）

  | 字段 | 类型 | 说明 |
  |---|---|---|
  | `metricId` | `MetricId` | 当前选中的指标（cpu / memory / network / disk） |
  | `timeWindow` | `[number, number]` | 当前时间窗口，以 bin 索引表示 |
  | `activeDomainId` | `string \| null` | 当前激活的故障域过滤 |
  | `selectedMachineIndex` | `number \| null` | 当前选中的机器 |
  | `machineFilterIndices` | `number[] \| null` | 主图框选产生的机器子集过滤 |

  另外 `data` 与 `grid` 使用 `shallowRef` 包装，避免对深层数据结构启用响应式追踪以保持选择器性能。

- **Computed Getter**（直接复用 [selectors.ts](../src/core/selectors.ts) 的纯函数，由 Vue `computed` 自动 memo）

  - `machineMetricPeaks` — 仅依赖 `data` 与 `grid`，metric/domain 切换不重算。
  - `visibleMachineIndices` / `filteredMachineIndices` — 顶 48 台可见机器与框选过滤后的机器集合。
  - `windowMachineStats` — 当前窗口内每台机器的均值、峰值、主导指标统计。
  - `selectedMachineStat` — 选中机器对应的 stat（无效则回退到峰值最高的机器）。
  - `hasActiveHeatmapFilter` / `hasScopeFilter` — 派生的 UI 状态。

- **Action**

  - `bootstrap()` 与 `ensureGrid()` 处理首屏 JSON 加载与二进制矩阵的懒加载。
  - `setMetric / setTimeWindow / setActiveDomain / toggleDomain / setSelectedMachine / setMachineFilter` 单字段修改。
  - `applyHeatmapBrush(payload)` 在主热力图框选完成时一次性原子写入 timeWindow + machineFilter + selectedMachine，避免触发多次 watch。
  - `clearHeatmapFilter` / `clearScopeFilter` / `activateHotspot` 处理常用复合操作。

### 视图层（Vue 面板组件）

主页面由四个面板组件组成，均订阅 store 派生数据自动重绘：

| 组件 | 职责 |
|---|---|
| [HeaderBar.vue](../src/components/HeaderBar.vue) | 顶部 nav、指标按钮、说明文案、selection badges、清除作用域按钮 |
| [HeatmapPanel.vue](../src/components/HeatmapPanel.vue) | 主热力图（base + overlay 双 canvas）、brush 时间轴、图例、加载占位、pointer 拖拽框选 |
| [StructurePanel.vue](../src/components/StructurePanel.vue) | 上下两段：CPU vs 内存散点图、故障域条形图 |
| [MachineDetailPanel.vue](../src/components/MachineDetailPanel.vue) | 选中机器的四指标 small multiples 曲线 |

辅助组件：

- [Tooltip.vue](../src/components/Tooltip.vue) + [useTooltip.ts](../src/composables/useTooltip.ts) 提供共享 tooltip provider，所有面板通过 `inject` 统一发送显示/隐藏事件。
- [useTermTooltips.ts](../src/composables/useTermTooltips.ts) 给方法说明文章中的 `data-term-tooltip` 元素接事件委托。
- [useHashSync.ts](../src/composables/useHashSync.ts) 把 store 与 URL hash 双向绑定（详见下文）。

每个面板组件内部都使用 `ResizeObserver` 监听容器尺寸变化触发 D3 重绘；交互产生的本地状态（pointer 拖拽位置、hover 行）保留在面板内部，不进入 store。

### 绘图层（src/core/draw/）

| 文件 | 职责 |
|---|---|
| [heatmap.ts](../src/core/draw/heatmap.ts) | `drawHeatmapBase` / `drawHeatmapOverlay` / `renderBrushChart` / `locateHeatmapCell` / `buildPalette` |
| [structure.ts](../src/core/draw/structure.ts) | `renderScatter` / `renderDomainBars` |
| [machine-detail.ts](../src/core/draw/machine-detail.ts) | `renderMachineDetail` |

绘图函数都是纯函数：接收 DOM 节点 + 数据 + 回调，执行命令式 D3 / Canvas 绘制，不持有状态、不读取 store。

## 数据加载策略

前端数据分两级加载，以控制 GitHub Pages 首屏体积：

1. **首屏 JSON（同步并行加载）** — `loadInitialData()` 并行拉取 `manifest.json`、`machines.json`、`cluster-summary.json`、`hotspots.json`、`domains.json`。这些文件体积小，承载页面标题、热点列表、故障域结构等元信息。`store.bootstrap()` 在 `App.vue` 的 `onMounted` 中调用一次。
2. **二进制网格（懒加载）** — `machine-grid.bin` 是真正的时序矩阵（machineCount × binCount × 4 metrics，每格 1 byte）。它在 `HeatmapPanel.vue` 挂载后通过 `store.ensureGrid()` 触发；加载期间面板显示「正在加载热力图数据…」占位。

二进制格式采用扁平 Uint8Array，按 `[metricIndex][binIndex][machineIndex]` 排布，`255` 表示缺失值。这种格式比 JSON 紧凑数十倍。

## URL Hash 协议

主页通过 [useHashSync.ts](../src/composables/useHashSync.ts) 把核心状态编码到 URL hash，实现刷新或分享时还原视图。

- **格式**：`#m=cpu&w=200,260&fd=A&mi=8123`

  | 字段 | 含义 | 缺省 |
  |---|---|---|
  | `m` | metricId（必须为 `cpu/memory/network/disk` 之一） | 默认热点的 metricId |
  | `w` | `startBin,endBin` 的时间窗口（自动 `clampWindow`） | 默认热点窗口或 manifest 默认窗口 |
  | `fd` | 故障域 id（必须存在于 `domains.json`） | 不写入即清空 |
  | `mi` | machineIndex（必须存在于 `machines.json`） | 不写入即不修改选中 |

- **回退规则**：解析失败的字段被忽略，store 保持当前值；非法值被丢弃后 store 不变。
- **写入时机**：watch `metricId / timeWindow / activeDomainId / selectedMachineIndex` 变化，rAF 节流后通过 `history.replaceState` 写入。
- **环路防护**：写入前缓存目标 hash 作为哨兵；hashchange 触发时若与哨兵匹配则忽略，避免 store→hash→store 循环。
- **作用域**：仅主页注入 `useHashSync`；`methodology.html` 不读写 hash。

## 多页面与方法说明

Vite 通过 `rollupOptions.input` 配置两个入口：

- `index.html` → `src/main.ts` → 主页面（三象限可视化）。
- `methodology.html` → `src/methodology-main.ts` → [MethodologyPage.vue](../src/pages/MethodologyPage.vue) 独立页面，复用 [renderMethodologyMarkup](../src/core/templates.ts) 通过 `v-html` 渲染方法说明文章。

主页 HeaderBar 的 nav 中 `方法说明` 链接指向 `./methodology.html`；方法页 nav 中的 `返回主图` 链接指向 `./`。两页共享 styles.css 与 Tooltip 组件，但不共享 store（方法页不读 hash、不加载 grid）。

## 交互与渲染调度

所有交互通过 store action 修改 state，Vue 响应式系统自动触发面板重绘：

```
用户交互（点击/框选/brush）
    ↓
调用 store action（setMetric / setTimeWindow / applyHeatmapBrush ...）
    ↓
Vue computed 失效 → 面板 watch 回调 → requestAnimationFrame 绘图
    ↓
Canvas / SVG 局部更新
```

关键性能要点：

- `machineMetricPeaks` 单独拆 getter，metric/domain 切换不重扫整个 grid。
- `visibleMachineIndices` 与 `windowMachineStats` 不读取 `selectedMachineIndex` 和 `machineFilterIndices`（这两个字段不参与计算），避免选中机器变化时连锁重算下游 stats。
- `applyHeatmapBrush` 一次性原子更新多字段，watch 只触发一次。
- 面板内的 overlay 重绘通过 `requestAnimationFrame` 合并多次 invalidation。
- hash 写入也用 rAF 节流，drag 期间最多 1 次 `replaceState/帧`。

## 关键设计决策

### 为什么用命令式 D3 而不是 Vue 响应式渲染图表？

本项目涉及大量自定义 Canvas 绘制、D3 scale/axis/brush 的精细控制和复杂的交叉高亮逻辑。Vue 的虚拟 DOM 和响应式系统对这类高度优化的可视化场景反而是负担。采用命令式渲染可以直接操作 Canvas 和 SVG，避免不必要的 diff 开销，也方便实现 tooltip、pointer capture 等底层交互。

### 为什么选择三象限单屏布局，而不是文章式纵向滚动？

旧版采用文章式布局，热力图、机器分布、单机曲线分散在三屏，需要用户手动滚动才能比较全局与局部。新版改为 12 列 CSS Grid 三象限：左 8 列主热力图（纵贯两行）+ 右上故障域结构 + 右下单机详情。在 1440×900 视口下三个层次同屏可见，框选/选机器引发的跨视图联动可以即时感知。

### 为什么把状态从控制器迁移到 Pinia？

旧版的 `ClusterPulseApp` 既持有状态又直接调用渲染器，导致 state mutation 必须经过控制器手动调度 `renderInteractiveViews()`，并且无法跨视图共享。Pinia 把状态外置后，面板组件之间不再相互依赖；URL hash 同步、方法页跳转、未来增加的卡片等都只需订阅 store。

### 为什么选择静态数据 + GitHub Pages，而不是服务端？

数据集是固定的历史 trace，没有实时更新需求。静态聚合后体积可控（sample 模式下整个数据包约数百 KB），无需维护后端服务，部署成本为零。

### 为什么热力图机器数限制为 48 台？

在 sample 数据集中，原始机器数约数百台。全部渲染会导致 Canvas 行高过密、交互命中率下降、视觉辨识度变差。选择器按当前指标的峰值排序并截取 Top 48，既保留了最热点的机器，又保证了渲染性能和可读性。
