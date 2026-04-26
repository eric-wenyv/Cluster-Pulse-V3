# 项目结构与文件约定

本文档说明各目录和关键文件的用途，以及模块之间的依赖边界。

## 根目录

```
.
├── data/
│   ├── raw/              # 完整原始数据（gitignore，本地生成）
│   └── raw-sample/       # sample 原始数据（gitignore，本地生成）
├── doc/                  # 项目文档（本文档所在目录）
├── docs/                 # Vite 构建输出 + GitHub Pages 发布目录
│   ├── index.html        # 主页构建产物
│   ├── methodology.html  # 方法说明独立页面构建产物
│   ├── assets/           # 构建产物 JS/CSS
│   └── data/             # 构建时复制自 public/data/
├── public/
│   └── data/             # 开发时静态数据（JSON + bin）
├── scripts/              # Python / Bash 数据管道脚本
├── src/
│   ├── components/       # Vue 面板组件
│   ├── composables/      # 通用 Vue 组合式函数（hash sync / tooltip / 术语注释）
│   ├── core/             # 可视化内核
│   │   └── draw/         # D3 / Canvas 命令式绘图函数
│   ├── pages/            # 多页面入口的页面组件
│   ├── stores/           # Pinia store
│   ├── styles.css        # 全局样式
│   ├── App.vue           # 主页根组件
│   ├── main.ts           # 主页入口
│   └── methodology-main.ts # 方法说明页入口
├── index.html            # 主页 HTML 模板
├── methodology.html      # 方法说明 HTML 模板
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### `docs/` 的特殊性

`docs/` 是 Vite 的 `build.outDir`，同时也是 GitHub Pages 的发布源。这意味着：

- **不要直接手动修改 `docs/` 下的文件**，所有变更都应通过源码修改后由 GitHub Actions 构建生成。
- `docs/data/` 在构建时由 Vite 从 `public/data/` 复制而来。
- `docs/` 由 GitHub Actions 自动构建并部署，**不需要手动 stage 或提交**。

## `src/components/` — Vue 面板组件

| 文件 | 职责 |
|---|---|
| [App.vue](../src/App.vue) | 主页根组件。挂载 store、注入 hash sync、组合三象限面板。 |
| [HeaderBar.vue](../src/components/HeaderBar.vue) | 顶部 nav、指标按钮、说明文案、selection badges、清除作用域按钮。 |
| [HeatmapPanel.vue](../src/components/HeatmapPanel.vue) | 主热力图：base + overlay 双 canvas、brush 时间轴、图例、pointer 拖拽框选。 |
| [StructurePanel.vue](../src/components/StructurePanel.vue) | 右上象限：CPU vs 内存散点 + 故障域条形图。 |
| [MachineDetailPanel.vue](../src/components/MachineDetailPanel.vue) | 右下象限：选中机器的四指标 small multiples。 |
| [Tooltip.vue](../src/components/Tooltip.vue) | 共享 tooltip 渲染层（fixed 定位）。 |
| [AppStatus.vue](../src/components/AppStatus.vue) | 数据加载失败时的错误提示面板。 |

## `src/pages/` — 多页面入口

| 文件 | 职责 |
|---|---|
| [MethodologyPage.vue](../src/pages/MethodologyPage.vue) | 方法说明独立页面。加载 AppData，复用 `renderMethodologyMarkup` 通过 `v-html` 渲染文章；本页注册 term tooltip 事件委托。 |

## `src/composables/` — Vue 组合式函数

| 文件 | 职责 |
|---|---|
| [useHashSync.ts](../src/composables/useHashSync.ts) | 把 store 与 URL hash 双向绑定（rAF 节流 + 哨兵字符串防环路）。仅主页使用。 |
| [useTooltip.ts](../src/composables/useTooltip.ts) | 通过 `provide/inject` 暴露 `{show, hide}` 给所有面板组件共享单一 Tooltip 实例。 |
| [useTermTooltips.ts](../src/composables/useTermTooltips.ts) | 在指定容器内对 `[data-term-tooltip]` 元素做事件委托，调用 `useTooltip` 显示术语解释。 |

## `src/stores/` — Pinia 状态层

| 文件 | 职责 |
|---|---|
| [visualization.ts](../src/stores/visualization.ts) | 主可视化状态 store：5 个 ref 状态字段 + 8 个 computed getter（直接复用 selectors）+ 13 个 action（含 `applyHeatmapBrush` 原子写入、`activateHotspot` 跳转）。 |

## `src/core/` — 可视化内核

### 数据与类型

| 文件 | 职责 |
|---|---|
| [data.ts](../src/core/data.ts) | 数据加载器。`loadInitialData()` 并行加载 5 个 JSON；`loadGrid()` 拉取二进制矩阵并校验长度。 |
| [types.ts](../src/core/types.ts) | 全部 TypeScript 类型定义。包括 AppState、AppData、GridData、各类渲染数据类型。 |
| [constants.ts](../src/core/constants.ts) | 常量定义：指标顺序、指标元数据（标签/颜色/描述）、图表边距、术语解释表。 |

### 工具函数

| 文件 | 职责 |
|---|---|
| [utils.ts](../src/core/utils.ts) | 通用工具：asset 路径解析、数字/百分比/时间格式化、窗口裁剪、grid 值读取、HTML 转义、术语标签渲染。 |
| [selectors.ts](../src/core/selectors.ts) | 数据选择器与派生计算。store getter 直接调用，不再传缓存键（由 Vue computed 自动 memo）。 |
| [templates.ts](../src/core/templates.ts) | `renderMethodologyMarkup()` 生成方法说明文章 HTML。 |

### 绘图函数 `src/core/draw/`

绘图函数是无状态的纯函数：接收 DOM 节点 + 数据 + 回调，由面板组件调用。

| 文件 | 职责 |
|---|---|
| [heatmap.ts](../src/core/draw/heatmap.ts) | `drawHeatmapBase` / `drawHeatmapOverlay` / `renderBrushChart` / `locateHeatmapCell` / `buildPalette`。 |
| [structure.ts](../src/core/draw/structure.ts) | `renderScatter` / `renderDomainBars`。 |
| [machine-detail.ts](../src/core/draw/machine-detail.ts) | `renderMachineDetail` 渲染选中机器四指标曲线。 |

## `scripts/` — 数据管道

| 文件 | 职责 |
|---|---|
| [download_alibaba.sh](../scripts/download_alibaba.sh) | 下载 Alibaba trace 原始数据。支持 `full`（完整 tar.gz）和 `sample`（流式抽取前 N 行）两种模式。 |
| [build_data.py](../scripts/build_data.py) | 核心数据构建脚本。读取原始 CSV，聚合、清洗、计算热点，输出 JSON 和二进制矩阵。 |
| [verify_data.py](../scripts/verify_data.py) | 数据校验脚本。检查所有必需文件、二进制长度、索引一致性、窗口合法性。 |

## `data/` 与 `public/data/`

| 目录 | 说明 |
|---|---|
| `data/raw/` | 完整原始数据存放处（`machine_meta.tar.gz` + `machine_usage.tar.gz`）。由 `download_alibaba.sh full` 生成。**已加入 .gitignore。** |
| `data/raw-sample/` | sample 模式原始数据存放处。由 `download_alibaba.sh sample` 生成。**已加入 .gitignore。** |
| `public/data/` | 前端开发服务器使用的静态数据。由 `npm run data` 或 `npm run data:sample` 生成。开发时必须存在，否则页面无法加载。 |

## 模块边界约定

1. **面板组件持有 DOM，调 store action**。组件内部维护本地交互状态（pointer 拖拽、hover 行等），通过 store action 提交全局状态变更。
2. **绘图函数不读取 store，不修改 DOM 之外的全局状态**。函数签名形如 `(elementRef, data, callbacks)`；状态变更通过回调上交给面板组件。
3. **选择器不直接操作 DOM**。`selectors.ts` 中的纯函数只负责数据计算，由 store getter 通过 `computed` 暴露给视图层。
4. **store 不直接调用绘图函数**。store 只持有数据；具体绘制逻辑由面板组件订阅 store 后驱动。
5. **模板文件只输出 HTML 字符串**。`templates.ts` 不绑定事件，term tooltip 的事件委托由 `useTermTooltips` 在挂载后注册。
6. **数据脚本不依赖前端代码**。`scripts/` 是独立的数据管道，输出格式由 `types.ts` 中的类型定义约定，双向修改需同步。
