# Issue #2 数据管线交接说明

## 本次完成内容

Issue #2 已把 Alibaba Cluster Trace 2018 的 container 与 batch 数据接入现有静态数据构建链路。主要改动如下：

- `scripts/build_data.py`
  - 扩展输入发现，支持 `machine_meta`、`machine_usage`、`container_meta`、`container_usage`、`batch_task`、`batch_instance` 六张表。
  - 新增 container 聚合，输出 `containers_per_machine_per_bin.bin`。
  - 新增 batch instance 聚合，输出 `batch_load_per_machine_per_bin.bin`。
  - 新增热点窗口内 batch task DAG 采样，输出 `batch_task_dag.json`。
  - 在 `manifest.json` 中新增 `artifacts`、`containerMetaRowCount`、`containerRowCount`、`batchTaskRowCount`、`batchInstanceRowCount` 和说明 notes。

- `scripts/verify_data.py`
  - 校验新增 3 个产物是否存在。
  - 校验 container grid、batch grid 长度是否与 `machineCount`、`binCount` 一致。
  - 校验 DAG 节点数量不超过 200，节点时间窗口合法，edge 两端节点存在。

- `scripts/download_alibaba.sh`
  - `full` 模式下载四张新增官方表。
  - `sample` 模式完整抽取 `container_meta`、`batch_task`，并对 `container_usage`、`batch_instance` 做前 N 行流式采样。

- `src/core/types.ts`
  - 新增 `ContainerGrid`、`BatchGrid`、`TaskDag` 类型。
  - 给 `Manifest` 增加可选 `artifacts` 和新增 row count 字段。

- `src/core/data.ts`
  - 新增 `loadContainerGrid()`、`loadBatchGrid()`、`loadTaskDag()`。
  - `loadGrid()` 改为优先读取 `manifest.artifacts.machineGrid`，兼容旧 manifest。

## 新增数据产物

### `containers_per_machine_per_bin.bin`

- 类型：`u16` little-endian。
- 布局：`bin-major`。
- 索引公式：`(binIndex * machineCount + machineIndex) * 2`。
- 含义：某台机器在某个 15 分钟 bin 内出现过的唯一 container 数量。

### `batch_load_per_machine_per_bin.bin`

- 类型：`u8`。
- 指标顺序：`cpu`、`memory`、`network`、`disk`。
- 布局：与 `machine-grid.bin` 一致，即 `metric -> bin -> machine`。
- 索引公式：`metricIndex * binCount * machineCount + binIndex * machineCount + machineIndex`。
- 缺失值：`255`。
- 注意：官方 `batch_instance` 只有 CPU/MEM 字段，没有 network/disk，所以 network/disk 目前固定为缺失值 `255`，没有伪造数据。

### `batch_task_dag.json`

结构示例：

```ts
{
  window: { startBin: number; endBin: number };
  nodes: Array<{
    id: string;
    jobName: string;
    taskName: string;
    type: string;
    startBin: number;
    endBin: number;
    x: number;
    y: number;
    resourceScore: number;
  }>;
  edges: Array<{ source: string; target: string }>;
  notes?: string[];
}
```

当前 DAG 坐标是确定性预计算：`x` 主要按任务开始 bin 分布，`y` 按排序位置分布。由于 Alibaba `task_name` 的依赖关系解析不够稳定，当前不伪造边，`edges` 可以为空。

## Manifest 对接契约

`manifest.json` 新增字段如下：

```json
{
  "artifacts": {
    "machineGrid": "machine-grid.bin",
    "containerGrid": "containers_per_machine_per_bin.bin",
    "batchGrid": "batch_load_per_machine_per_bin.bin",
    "batchTaskDag": "batch_task_dag.json"
  },
  "containerMetaRowCount": 0,
  "containerRowCount": 0,
  "batchTaskRowCount": 0,
  "batchInstanceRowCount": 0
}
```

这些字段在前端类型里是可选字段。旧数据包没有这些字段时，`src/core/data.ts` 会回退到默认文件名。

## 给其他同学的对接方式

### 给 Issue #1 同学

Issue #1 主要做布局、store 和 URL deep link，不需要直接改数据管线。需要对齐的是：

- `manifest.artifacts` 是后续新数据文件的统一入口。
- 如果 URL/store 里保存 `metricId`，仍然只使用现有四个指标：`cpu`、`memory`、`network`、`disk`。
- `machineIndex`、`binIndex` 的含义和旧 `machine-grid.bin` 保持一致。

### 给 Issue #3 同学

Issue #3 做热力图 Focus + Context 和容器密度叠加层时，可以直接使用：

- `loadContainerGrid(manifest)` 读取 `containers_per_machine_per_bin.bin`。
- `ContainerGrid.values` 是 `Uint16Array`。
- container grid 的索引公式是 `binIndex * machineCount + machineIndex`。
- 容器密度叠加层建议基于当前 heatmap cell 的 container count 做 hatching 或透明度编码。

如果需要 batch 负载：

- 使用 `loadBatchGrid(manifest)`。
- batch grid 的索引方式和 `machine-grid.bin` 一致。
- CPU/MEM 可用，network/disk 当前为 `255` 缺失值，需要在可视化里跳过。

如果需要 DAG tooltip：

- 使用 `loadTaskDag(manifest)`。
- `nodes.length <= 200`。
- 目前 `edges` 可能为空，tooltip 应该能优雅展示“只有任务节点，没有依赖边”的情况。

### 给 Issue #6 / #7 同学

- Issue #6 的 Batch Swimlane 可以优先基于 `batch_task_dag.json.nodes` 的 `startBin/endBin` 做时间段展示。
- Issue #7 的 DAG tooltip 可以直接复用 `batch_task_dag.json`，但不要假设一定有边。
- 如果后续确认了稳定的 task dependency 解析规则，只需要增强 `build_batch_task_dag()` 的 edge 生成逻辑，前端结构不用大改。

## 验证结果

已通过：

```bash
python -m py_compile scripts/build_data.py scripts/verify_data.py
npx tsc --noEmit
```

已用临时最小 fixture 跑通完整数据链路：

```bash
python scripts/build_data.py --input-root <fixture/raw> --fallback-root <fixture/raw> --output-root <fixture/out> --period-seconds 3600
python scripts/verify_data.py <fixture/out>
```

输出结果包含：

- `containers_per_machine_per_bin.bin`
- `batch_load_per_machine_per_bin.bin`
- `batch_task_dag.json`

前端静态构建也已通过：

```bash
npx vite build
```

## 当前环境限制

当前仓库没有可用的 `data/raw` 或 `data/raw-sample` 输入文件，所以无法直接用真实 Alibaba 数据跑 `npm run data`。

另外当前 Windows 环境中 `python3` 命令不可用，而 `package.json` 的脚本使用的是 `python3`，因此：

```bash
npm run data
npm run build
```

会在调用 `python3` 时失败。使用 `python` 直接运行脚本可以通过。后续可以考虑把 `package.json` 里的 `python3` 改成跨平台写法，或要求 Windows 同学安装 `python3` 命令别名。
