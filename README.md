# Cluster Pulse

基于 Alibaba Cluster Trace 2018 的集群资源热点可视化项目。项目使用静态聚合数据驱动前端页面，部署目标为 GitHub Pages。

## 功能概览

- 展示 CPU、内存、网络、磁盘四类机器级资源热点
- 通过热力图、散点图、故障域条形图和单机曲线联动分析

## 技术栈

- Vue 3
- TypeScript
- Vite
- D3
- Python 3（用于数据构建和校验）

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
