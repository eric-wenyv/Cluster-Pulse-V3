# WebGL 评估

本文记录 Issue #3 第一阶段的 WebGL 评估结论。当前实现不立即引入 regl 或 deck.gl，而是先增加运行时渲染策略护栏：视图根据实际 primitive 数量和浏览器 WebGL 能力判断继续使用 D3/SVG，还是进入 WebGL 兜底路径。

## 当前 sample 数据规模

当前 `public/data/manifest.json` 显示：

| 项目 | 数量 |
|---|---:|
| 机器 | 177 |
| 时间桶 | 768 |
| 指标 | 4 |
| 故障域 | 119 |
| machine usage 行 | 1,200,000 |
| container usage 行 | 1,033,590 |
| batch instance 行 | 1,185,047 |

主热力图使用 Canvas 绘制，不属于本阶段 WebGL 迁移目标。当前散点图消费的是 `store.windowMachineStats`，而 `getVisibleMachineIndices()` 仍限制可见机器 Top 48，因此 sample 模式下每次散点重绘只产生几十个 SVG circle，D3/SVG 足够稳定。

## 评估结论

### 散点图

- 当前状态：保留 D3/SVG。
- 原因：sample 模式下渲染点数远低于 SVG 风险区间，交互点选、tooltip、坐标轴和密度轮廓都已有 D3 实现。
- 兜底建议：如果后续取消 Top 48 限制，或展示全量/跨窗口点云超过 15,000 点，应新增 regl 散点层，只保留 D3 绘制坐标轴和少量交互 overlay。
- 不优先 deck.gl 的原因：当前散点是普通二维笛卡尔图，regl 更轻；deck.gl 更适合地图坐标、大量 layer 组合和内建 picking 需求。

### Gantt swimlane

- 当前状态：仓库内尚未实现 Gantt swimlane 组件。
- 预判：如果未来批处理任务泳道图矩形数低于 2,500，可先用 D3/SVG；超过 12,000 个可见矩形时建议切 regl instanced rectangles。
- 额外护栏：当 lane 数超过约 250 时，即使矩形数量不高，也需要先做行虚拟化，因为 DOM 文本标签和行布局会先成为瓶颈。
- deck.gl 选择条件：只有当 Gantt 需要多层复合渲染、复杂 GPU picking 或与地图/空间 layer 组合时，再评估 deck.gl。

## 代码落点

- [rendering-strategy.ts](../src/core/rendering-strategy.ts) 定义 WebGL 能力检测和 primitive 阈值评估。
- [StructurePanel.vue](../src/components/StructurePanel.vue) 在散点图重绘时执行 `evaluateScatterWebGL()`，并在标题区域显示当前渲染策略徽标。

阈值如下：

| 视图 | D3/SVG 安全上限 | WebGL handoff |
|---|---:|---:|
| scatter | 3,000 点 | 15,000 点 |
| Gantt swimlane | 2,500 矩形 | 12,000 矩形 |

这些阈值是保守护栏，不是硬件基准测试结果。后续性能压测完成后，可以根据 Chrome Performance 面板中的 frame time 和 scripting/rendering breakdown 调整。

## 后续迁移路径

1. 保持 D3 负责坐标轴、文字、brush 和少量交互 overlay。
2. 当 `WebGLAssessment.recommendedRenderer !== 'd3-svg'` 时，挂载 regl canvas 层。
3. 使用 typed arrays 传递点或矩形实例属性，避免为每个 primitive 生成 DOM。
4. 保留 D3/SVG 降级路径，供 WebGL 不可用或数据量较小场景使用。

## Worker 统计护栏

Issue #3 第二阶段已将窗口内机器统计迁移到 Web Worker：

- [window-stats.worker.ts](../src/workers/window-stats.worker.ts) 在 worker 线程中扫描 `machine-grid.bin`、计算四指标均值/计数/峰值，并按当前指标排序。
- [window-stats-worker.ts](../src/core/window-stats-worker.ts) 是主线程 client，负责初始化 worker、发送窗口参数、丢弃过期响应，并把 typed-array payload 还原成现有 `WindowMachineStat[]`。
- [visualization.ts](../src/stores/visualization.ts) 保留同步 `getWindowMachineStats()` 作为降级路径；如果 Worker 不可用或运行失败，UI 会继续显示主线程计算结果。
- `StructurePanel` 的渲染策略 tooltip 会显示「窗口统计 Worker」或「窗口统计 主线程回退」，便于手动验证。

Worker 返回值使用 `Int32Array`、`Float32Array`、`Uint32Array`、`Uint8Array` 和 `Int16Array`，并通过 transferable buffers 回传，避免在主线程和 worker 之间复制大量对象。
