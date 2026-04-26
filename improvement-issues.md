# 改进 Issue 清单

> 共 8 个 issue，覆盖布局重构、数据扩展、可视化升级与性能优化。
> 其中 **Issue #1 / #2 / #3 / #8** 为架构/工程优化类，不依赖图表设计评审，可立即开工；**Issue #4 / #5 / #6 / #7** 涉及新图表类型，需等设计确定后实施。

---

## Issue #1 — 重构：协调视图驾驶舱布局 + 全局状态 Store + URL Deep Link

### 背景

当前页面采用文章式纵向布局（Hero → 热力图 → Explorer → 方法说明），三个核心视图分散在三屏，通过 `section-bridge` 文字衔接。用户必须滚动才能在全局热点、机器分布、单机曲线之间切换，无法同时观察关联。

### 方案

1. 用 CSS Grid 12 列构建驾驶舱主体：左侧 8 列承载主热力图（含 minimap），右侧 4 列上下分两段（上：故障域 + 散点；下：单机详情）。底部 drawer 收起方法说明。
2. 引入 Vue `reactive` 全局 store（或用 Pinia），统一管理 `timeWindow`、`metricId`、`selectedMachineIndex`、`activeDomainId`。
3. 所有 renderer 改为订阅模式：接收派生数据而非直接操作 DOM，状态变更时自动重渲染对应模块。
4. URL hash 编码上述 4 个状态字段（如 `#m=cpu&w=200,260&fd=A&mi=8123`），进入页面时解析还原。
5. 视口自适应：≥1280px 走完整四象限；窄屏退化为 tab 切换，而非纵向罗列。

### 验收标准

- [ ] 1440×900 视口下一屏可见「热力图 + 结构视图 + 单机详情」三象限。
- [ ] 刷新页面不丢失状态，复制 URL 他人打开可复现完全相同的视图。
- [ ] 任意视图状态变更在 < 16ms 内反映到其它视图。
- [ ] 旧版纵向布局代码彻底移除，无冗余 DOM 残留。

### 涉及文件

`src/App.vue`、`src/components/ClusterPulseViewport.vue`、`src/core/cluster-pulse-app.ts`、新建 `src/core/store.ts`、`.css`

---

## Issue #2 — 优化：数据管线扩展，接入 container + batch 四张表

### 背景

Alibaba Cluster Trace 2018 含 `container_meta`、`container_usage`、`batch_task`、`batch_instance` 四张表，当前 `build_data.py` 完全未读取。后续视图需要容器密度和批处理负载数据，必须先完成数据聚合。

### 方案

1. **Container Pipeline**：读取 `container_meta` + `container_usage`，按 15min bin 聚合每台机器上的 container 实例数，产出 `containers_per_machine_per_bin.bin`（u16 矩阵）。
2. **Batch Pipeline**：读取 `batch_task` + `batch_instance`，按运行区间分摊 CPU/MEM/网络/磁盘到 15min bin，产出 `batch_load_per_machine_per_bin.bin`（u8 矩阵 × 4 指标）。
3. **DAG Pipeline**：在热点窗口内采样活跃的 batch task，产出 `batch_task_dag.json`（节点 ≤ 200，预计算力导向布局坐标，前端只渲染）。
4. `download_alibaba.sh` 的 `sample` 模式同步增加这两张表的流式抽取。
5. `verify_data.py` 校验新增文件的长度、索引一致性、窗口合法性。
6. `types.ts` 追加 `ContainerGrid`、`BatchGrid`、`TaskDag` 类型；`manifest.json` 加入新文件引用，旧版前端忽略未知字段（向后兼容）。

### 验收标准

- [ ] `npm run data:sample` 完整产出新增的 3 个文件。
- [ ] `python scripts/verify_data.py` 通过全部校验。
- [ ] 旧版前端加载新 `manifest.json` 不报错（graceful degradation）。
- [ ] container 矩阵文件大小 ≈ machine grid × 2（u16 vs u8），在可接受范围内。

### 涉及文件

`scripts/build_data.py`、`scripts/verify_data.py`、`scripts/download_alibaba.sh`、`src/core/types.ts`

---

## Issue #3 — 重构：主热力图升级为 Focus + Context，并叠加容器密度层

### 背景

当前 `heatmap-base` + `heatmap-overlay` 是单一大画布（1200×720），底部配 SVG brush。要看细节必须放大，看全局必须缩小，无法同时保留两种尺度。

### 方案

1. **Focus + Context 结构**：
   - **Detail Canvas**（左侧主图）：只渲染当前 `timeWindow` × 可见机器，每行 ≥ 4px，保证 bin 级可读。
   - **Context Minimap**（右下角小图）：固定渲染完整 8 天 × 全部机器的下采样视图，brush 直接画在 minimap 上。拖动 brush 时 detail 实时更新。
   - 两者共享 `heatmapBaseCache`，避免重复绘制。
2. **容器密度叠加层**：利用现有 `heatmap-overlay` Canvas 第二图层，用半透明斜线纹理（hatching）叠在底图上，斜线密度编码 `containers_per_machine_per_bin`。叠加层默认关闭，切换按钮控制。
3. 无叠加层时，热力图视觉与旧版完全一致（向后兼容）。

### 验收标准

- [ ] 主热力图区域一屏内同时呈现 detail + minimap，无纵向滚动。
- [ ] minimap brush 拖动时 detail 实时更新，延迟 < 16ms。
- [ ] 容器叠加层开关可控制；开启后能在同一画布判断「热点是否由容器密度驱动」。
- [ ] 无叠加层时，旧版热力图所有交互（框选、hover tooltip）正常工作。

### 涉及文件

`src/core/renderers/heatmap-renderer.ts`、`src/core/cluster-pulse-app.ts`、`src/core/selectors.ts`

---

## Issue #4 — 可视化：全局时间轴 Streamgraph + 在线/批处理混部 Mirror Chart（图表设计待定）

### 背景

当前 Hero 区用 4 张独立的 `mini-metric-card` ribbon 展示全局趋势，各看各的 y 轴，无法判断同一时间是哪个资源主导，也看不到在线与批处理的混部关系。

### 方案（待图表设计评审后锁定）

1. 顶部用 `d3.stack` + `d3.area` 把 4 个指标的 P99 序列堆叠成一条 streamgraph，横跨整个时间轴。
2. 下方紧贴一条 mirror（diverging）面积图：上半部 = 在线 container 资源占用，下半部 = 批处理 task 资源占用。
3. 共享 X 轴与主 brush：在 streamgraph 上拖动即设置 `timeWindow`。
4. 颜色沿用 `METRIC_META` 渐变色。

### 验收标准

- [ ] 一眼看出「Day3 12:00 是 CPU 主导，Day6 凌晨是磁盘主导」。
- [ ] mirror chart 能显示「夜间批处理上来时在线服务是否被挤压」。
- [ ] brush 操作与热力图、其它视图完全联动。

### 涉及文件

`src/core/renderers/`（新建）、`src/core/constants.ts`

### 状态

图表类型（streamgraph vs. 堆叠 horizon）尚未确定，等设计评审后开工。

---

## Issue #5 — 可视化：故障域 Icicle + 散点密度等高线/边际分布 + 相关性矩阵（图表设计待定）

### 背景

当前故障域只显示 top 10 条形，丢失了 `failureDomain1 / failureDomain2` 的层级结构。散点最多 240 个点，重叠时无密度表达。4 个指标之间的相关性完全未呈现。

### 方案（待图表设计评审后锁定）

1. **故障域**：横向 Icicle（D3 partition layout），第一层 FD1、第二层 FD2、第三层（hover/click 展开）单台机器。颜色编码当前指标峰值，宽度编码机器数。
2. **散点图**：放开 240 点限制，底层叠 `d3.contourDensity` 等高线。X/Y 轴外侧加 marginal ridgeline。
3. **相关性矩阵**：4×4 小型矩阵，cell 颜色编码当前 `timeWindow` 内 4 个指标对的 Spearman 相关系数。点击 cell 可将散点图主图临时切换到该指标对。

### 验收标准

- [ ] 能直接看出「热点集中在某个 FD1 下的特定 FD2」。
- [ ] 散点图能看出集群负载是均匀云团还是双峰。
- [ ] 能读出「Day5 窗口里 CPU 与网络强相关，但内存独立」。

### 涉及文件

`src/core/renderers/explorer-renderer.ts`、`src/core/selectors.ts`

### 状态

图表类型（icicle vs. sunburst、等高线 vs. 六边形分箱）尚未确定，等设计评审后开工。

---

## Issue #6 — 可视化：单机详情区 Horizon + Batch Swimlane + 排行表 Bullet/Sparkline（图表设计待定）

### 背景

当前单机详情是 4 张并列折线图（small multiples），纵向占 4 倍空间，且没有解释曲线起伏的原因。排行表只是纯文字数字。

### 方案（待图表设计评审后锁定）

1. **Horizon Chart**：4 个指标压成 4 条同高度彩带（3-band 折叠），纵向高度从约 480px 压到约 160px。共享同一时间轴和 brush 阴影。
2. **Batch Swimlane**：紧贴 horizon 下方，每条 lane 是一个 batch task，矩形长度 = 执行区间，颜色编码资源类型。与 horizon 共享 X 轴，使曲线尖峰对齐到具体 task。
3. **排行表**：每行加 Bullet（窗口峰值 vs 8 天 baseline）+ Sparkline（完整 8 天曲线，叠窗口阴影）。

### 验收标准

- [ ] 4 个指标在 ≤ 200px 高度内完整呈现。
- [ ] 曲线上的尖峰能直接对齐到下方 swimlane 的 task 区间。
- [ ] 排行表不点开单机详情就能判断热点机器的形态类型。

### 涉及文件

`src/core/renderers/explorer-renderer.ts`、`src/core/templates.ts`

### 状态

swimlane 布局（gantt vs. 简化 timeline）和 bullet 规格尚未确定，等设计评审后开工。

---

## Issue #7 — 可视化：DAG 溯源微图嵌入热点 Tooltip（图表设计待定）

### 背景

batch 任务的 DAG 依赖关系是天然的图结构，传统做法是另开 graph 页面，但违背高密度单屏原则。

### 方案（待图表设计评审后锁定）

1. 在主热力图 hover tooltip 和排行表 hover popover 内嵌 80×80 的 DAG 缩略图。
2. 节点 = task，边 = 依赖，节点尺寸 = 该 task 在当前 hover 时间窗口的资源贡献。
3. 力导向布局在 `build_data.py` 预计算，前端只渲染固定坐标。
4. 不单独开 DAG 页面，DAG 仅作为 hotspot 的解释配件。

### 验收标准

- [ ] hover 高峰 cell 时，tooltip 内直接显示「该高峰由 DAG 上 X 个相邻 task 推动」。
- [ ] DAG 渲染延迟 < 50ms。

### 涉及文件

`src/core/renderers/heatmap-renderer.ts`、`scripts/build_data.py`

### 状态

DAG 微图布局规格和 tooltip 尺寸尚未确定，等设计评审后开工。

---

## Issue #8 — 优化：性能护栏（WebGL/Worker/虚拟化）+ 平滑过渡动画

### 背景

引入更多数据后，前端可能面临数十万散点、Gantt 矩形和大量表格行。当前纯 D3 SVG + 主线程计算在数据量翻倍时会掉帧。状态切换目前是瞬时硬切，用户容易丢失 mental map。

### 方案

1. **WebGL 评估**：散点图和 Gantt swimlane 评估是否切到 `regl` 或 `deck.gl`。若数据量可控则保留 D3，否则 WebGL 兜底。
2. **Web Worker**：`selectors.ts` 的窗口聚合、排序、统计计算迁移到 Web Worker，主线程只接收 `Uint8Array` 结果。
3. **虚拟滚动**：排行表用虚拟滚动（`@tanstack/virtual` 或原生实现），可扩展到 top 500 不掉帧。
4. **平滑过渡**：D3 视图属性更新走 `.transition().duration(220)`；Canvas 层用 `requestAnimationFrame` 做 fade。

### 验收标准

- [ ] sample 模式 + 全部视图启用下，state 切换帧时间 < 33ms（30fps）。
- [ ] 切换指标时各视图色彩平滑过渡，非硬切。
- [ ] 排行表展示 top 500 时滚动不掉帧。
- [ ] Web Worker 不阻塞主线程 UI 交互。

### 涉及文件

`src/core/selectors.ts`、`src/core/renderers/*`、新建 `src/workers/`

---

## 实施顺序与并行排程

### 先完成的 4 个 Issue（可立即开工）

由于「页面设计和使用的图表还没有确定」，**Issue #4 / #5 / #6 / #7** 的可视化图表类型需要等设计评审后锁定。以下 4 个 issue 属于**架构重构、数据管线和性能优化**，不依赖新图表设计，可以立即开工：

| 顺序 | Issue | 性质 | 说明 |
|---|---|---|---|
| **P0** | **#1** 驾驶舱布局 + 状态 Store + URL | 架构重构 | 所有其它 issue 的承载壳，必须最先开工 |
| **P0** | **#2** 数据管线扩展 | 工程优化 | 与 #1 完全并行，不阻塞 |
| **P1** | **#3** 主热力图 focus+context + 容器叠加层 | 核心视图重构 | 依赖 #1 布局就位、#2 数据就绪 |
| **P1** | **#8** 性能护栏 + 平滑过渡 | 基础设施 | 建议在 #3 接近完成时接入调优 |

**#1 与 #2 完全并行**；**#3 需要 #1 的布局壳和 #2 的 container bin 文件**；**#8 建议在主要视图（#1/#3）就位后再做针对性优化**，避免过早优化。

### 二期 Issue（等图表设计确定后开工）

- **#4** 全局时间轴 Streamgraph + Mirror Chart
- **#5** 故障域 Icicle + 散点密度/边际 + 相关性矩阵
- **#6** 单机详情 Horizon + Swimlane + Bullet/Sparkline
- **#7** DAG 溯源 Tooltip

等 #1 / #3 / #8 落地后，页面已具备「单屏联动 + 完整数据 + 高性能」的骨架；此时再评审并锁定 #4–#7 的图表方案，填充右侧和底部的可视化细节。

---

## 并行排程示意（4 人团队）

```
Week 1     │ Week 2          │ Week 3        │ Week 3.5
───────────┼─────────────────┼───────────────┼─────────────
P1: #1 ───────► #3 ─────────────► #7 ──┐
P2: #1 协作 ──► #4 ──► #8 ─────────────┤
P3: #2 ────────► #6 ───────────────────┤
P4: ────────────► #5 ──────────► #8 ───┘
```
