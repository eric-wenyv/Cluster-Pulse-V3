# Cluster Pulse

基于 Alibaba Cluster Trace 2018 的集群资源热点可视化项目。项目使用静态聚合数据驱动前端页面，部署目标为 GitHub Pages。

## 功能概览

- **全局趋势**：Streamgraph 展示 CPU、内存、网络、磁盘四类资源的 8 天 P99 波动趋势，支持 brush 选取时间窗口
- **资源热点**：Focus+Context 热力图呈现机器级资源时序分布，支持框选、minimap 导航、容器密度叠加与多级 zoom 回退
- **混部对比**：Mirror Chart 对称展示在线容器密度与批处理 CPU 负载的时空关系
- **故障域层级**：Icicle 层级图可视化两层故障域（FD1 → FD2）的分布与峰值
- **指标关联**：散点图带核密度等高线，可分析任意两指标的相关性；悬浮相关性矩阵支持一键切换散点图指标对
- **单机详情**：Horizon Chart 紧凑展示选中机器的四指标形态，支持鼠标 hover 读数
- **任务依赖**：热力图与散点图 tooltip 中集成 DAG 缩略图，揭示高峰时段的批处理任务依赖关系
- **状态共享**：URL Hash 编码当前指标、时间窗口、故障域过滤和选中机器，支持刷新还原与链接分享

## 技术栈

- Vue 3 + Pinia（状态管理）
- TypeScript
- Vite
- D3（命令式绘图）
- Web Worker（窗口统计 offload）
- Python 3（数据构建、校验与混部数据聚合）

## 目录结构

- `src/`：前端源码
- `src/components/`：Vue 组件入口层
- `src/core/`：可视化内核、渲染器、选择器、模板和工具
- `scripts/`：数据下载、构建和校验脚本
- `public/data/`：开发时使用的静态数据
- `docs/`：Vite 构建输出，也是 GitHub Pages 发布目录

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务器：

```bash
npm run dev
```

## 数据生成

仅下载 sample 数据并生成前端数据：

```bash
npm run data:sample
```

如果已经有原始数据，重新生成静态数据：

```bash
npm run data
```

校验当前数据输出：

```bash
npm run check:data
```

## 构建

```bash
npm run build
```

构建后输出位于 `docs/`。

## 数据来源

- Alibaba Cluster Trace 2018
