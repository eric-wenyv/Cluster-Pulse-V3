import { TERM_EXPLANATIONS } from './constants';
import type { AppData, Hotspot } from './types';
import { renderTerm } from './utils';

export function renderMethodologyMarkup(data: AppData, leadHighlight: Hotspot | undefined): string {
  return `
    <h3>可视化方案要解答什么问题</h3>
    <p>
      这个可视化围绕一个具体而可检验的问题展开：在 Alibaba 2018 集群的 8 天 ${renderTerm('trace', TERM_EXPLANATIONS.trace)} 中，CPU、内存、网络与磁盘压力何时出现，
      热点是零散分布在少数机器上，还是集中在某些${renderTerm('故障域', TERM_EXPLANATIONS.failureDomain)}中；
      被选中的机器在完整周期里究竟表现为短时尖峰、持续高负载，还是多种资源同时抬升；
      在线服务容器与批处理任务在混部环境下如何相互影响；以及高峰时段的批处理任务依赖关系如何呈现。
    </p>
    <p>
      因此，顶部的 Streamgraph 负责回答"全局四类资源在 8 天内的总体趋势与波动形态"；
      主热力图负责回答"热点发生在什么时候、落在哪些机器上"；
      中段的 Mirror Chart 负责回答"在线容器密度与批处理 CPU 负载如何对称分布"；
      右上角的 Icicle 层级图负责回答"故障域的两层结构及各域的峰值分布"；
      散点图负责回答"当前窗口内任意两指标的相关性与密度分布"；
      相关性矩阵负责帮助用户快速选择最有分析价值的指标对；
      下方单机 Horizon Chart 负责回答"某台机器的四资源形态是否同步抬升"；
      DAG 缩略图则在 tooltip 中揭示"该高峰由哪些相邻批处理任务推动"。
      多个视图对应的是同一个问题的全局概览、时间聚焦、混部对比、空间层级、统计关联和任务依赖六个层次。
    </p>
    <h3>设计决策依据、替代方案与最终取舍</h3>
    <p>
      页面结构采用 Cockpit 仪表板式单屏布局：顶部 Streamgraph 作为全局上下文条，左侧主热力图占据纵向主体，
      下方 Mirror Chart 展示混部对比，右侧上方为故障域 Icicle 与指标散点，右侧下方为选中机器的四指标 Horizon Chart，
      底部为指标切换与状态栏。这种布局参考了 ${renderTerm('MBTA Viz', TERM_EXPLANATIONS.mbtaViz)} 把多种视图编排在同一画面上的做法，
      方便在 1440×900 视口里同时观察全局趋势、局部热点和单机解释三个层次。
    </p>
    <p>
      顶部最终选择 Streamgraph 而不是单折线或多重面积图。原因是它能在同一高度内用层叠波动同时呈现四类资源的相对体量与相位关系，
      wiggle offset 让每一层都有自己的可辨轮廓，便于一眼看出"哪类资源在何时主导了集群负载"。
      Streamgraph 同时集成了底部 brush，用户可以直接拖拽选取感兴趣的时间窗口，主热力图与下游视图会同步联动。
    </p>
    <p>
      主图最终选择 Focus+Context 热力图，而没有采用多折线或汇总柱图。原因是这个任务必须同时保留连续时间轴和按故障域排序后的机器分布；
      若改用折线，机器数量一多就会严重遮挡；若只做汇总柱图，虽然便于比较均值，却会丢失热点是"成片出现"还是"局部闪现"的结构信息。
      热力图右下角叠加了 minimap，白色半透明矩形标识当前 focus 窗口，支持拖拽平移和边缘拉伸，解决了"在 768 个时间桶中快速定位"的问题。
      容器密度叠加层（斜线 hatching）用可切换的半透明纹理编码每台机器上的在线容器数，不干扰主色阶的同时揭示了混部密度与资源热点的空间重叠。
    </p>
    <p>
      Mirror Chart 采用对称面积图，上方是在线容器平均密度，下方是批处理 CPU 平均负载，共享同一根时间轴中线。
      这种形式比双 Y 轴折线更节省垂直空间，也避免了不同量纲带来的刻度误导；
      对称布局让"在线高、批处理也高"的混部高峰一目了然。
    </p>
    <p>
      故障域部分从早期的条形图演进为 Icicle（层级分区图），是因为数据集提供匿名的两层故障域（failure_domain_1 与 failure_domain_2），
      条形图只能展示第一层聚合，无法表达"同一 FD1 下不同 FD2 的分布差异"。
      Icicle 用固定比例的分层矩形同时编码两层结构，颜色映射当前指标峰值，既保留了排序与面积比例，又提供了点击下钻过滤的交互。
      散点图部分在 D3/SVG 基础上增加了核密度等高线，帮助用户在点密集区域感知分布形态；
      右上角悬浮的 4×4 Spearman 相关性矩阵支持点击切换散点图指标对，让用户快速发现"哪些资源倾向于同时升高"。
    </p>
    <p>
      单机详情从四折线小型多重图改为 Horizon Chart。原因是右侧面板高度有限，传统四子图需要大量垂直空间且 Y 轴刻度不一致；
      Horizon Chart 把同一指标按 0–33%、33–66%、66–100% 切分为三层并向基线折叠，
      在不到传统折线图 1/3 的高度内保留了峰谷形态，同时用颜色深度编码强度，四指标可紧凑排列在同一面板内。
    </p>
    <p>
      交互上最终保留了指标切换、主图框选、故障域过滤、机器点击、多级缩放回退和 Ctrl+点击快速 zoom 六类操作。
      也考虑过只保留底部时间轴 ${renderTerm('brush', TERM_EXPLANATIONS.brush)} 的方案，但那样无法直接在主图里同时选择时间与机器范围；
      也考虑过更复杂的筛选菜单，但会打断阅读路径。
      最终版本选择在主热力图上直接框选，再让散点图、Icicle 与单机曲线同步联动，以减少界面跳转成本。
      Zoom Stack 机制允许用户连续下钻后逐层回退，避免了"一框选就丢失全局上下文"的问题。
      ${leadHighlight ? `页面默认聚焦 ${leadHighlight.title}，也是为了让首次进入页面的读者立即看到一个真实的热点窗口。` : '页面默认从全局最强热点窗口开始，避免首屏停留在过于平缓的状态。'}
    </p>
    <p>
      性能方面引入了双重护栏：一是 Web Worker -backed 窗口统计，把扫描 <code>machine-grid.bin</code> 和计算四指标均值/峰值的工作 offload 到独立线程，
      主线程只接收序列化后的 <code>WindowMachineStat[]</code>；二是 WebGL 渲染策略评估，在散点图重绘前根据当前点数、候选点数和浏览器 WebGL 能力判断继续用 D3/SVG 还是切到 WebGL 兜底路径。
      当前 sample 模式下可见机器被限制在 Top 48，散点图点数远低于 SVG 安全上限（3,000），因此仍使用 D3/SVG；
      该护栏为未来取消限制或切换到 full 数据集时保留了平滑的渲染迁移路径。
    </p>
    <h3>外部资源引用</h3>
    <p>
      数据源来自 Alibaba Cluster Trace 2018，本项目实际使用的是其中的 ${renderTerm('machine_meta', TERM_EXPLANATIONS.machineMeta)}、${renderTerm('machine_usage', TERM_EXPLANATIONS.machineUsage)}、
      container_meta、container_usage、batch_task 与 batch_instance 六张表。
      页面中的静态数据并非手工构造示例，而是由脚本下载原始数据后按 15 分钟时间窗聚合生成，
      再部署到 ${renderTerm('GitHub Pages', TERM_EXPLANATIONS.githubPages)}。
    </p>
    <p class="source-inline">
      参考资料：
      <a href="${data.manifest.sources.assignmentUrl}" target="_blank" rel="noreferrer">课程作业要求</a>
      <span> / </span>
      <a href="${data.manifest.sources.datasetDocsUrl}" target="_blank" rel="noreferrer">Alibaba trace 文档</a>
      <span> / </span>
      <a href="${data.manifest.sources.datasetSchemaUrl}" target="_blank" rel="noreferrer">Alibaba schema</a>
      <span> / </span>
      <a href="https://mbtaviz.github.io/" target="_blank" rel="noreferrer">MBTA Viz</a>
    </p>
    <h3>开发流程概述与评述</h3>
    <p>
      当前版本按 4 人小组协作推进，数据处理、前端实现、交互联动、样式调整与 GitHub Pages 部署通过 PR 分批合并。
      如果按工时估算，从方案确定、数据脚本编写、前端实现到上线整理大约花费 60 到 80 人时，其中最耗时的并不是单个视图搭建，而是三类工作：
      一类是把原始六张 trace 表清洗并压缩成适合静态网页加载的结构（JSON + 二进制矩阵）；
      另一类是反复调整主热力图、Streamgraph 和联动交互，使页面在 GitHub Pages 环境下既能显示真实数据，又不至于过于卡顿；
      第三类是多人协作时的接口对齐与合并冲突处理，尤其是数据管道输出格式变更会同时影响 Python 脚本和前端 TypeScript 类型定义。
    </p>
    <p>
      开发过程前期主要时间投入在数据管线和指标定义上，例如如何处理缺失值、如何定义热点、如何在 ${renderTerm('sample', TERM_EXPLANATIONS.sample)} 与 ${renderTerm('full', TERM_EXPLANATIONS.full)} 两种模式之间共享统一输出接口，
      以及如何将 container 和 batch 两类混部数据与机器级资源热点对齐到同一时间轴上。
      中后期则主要花在交互和版式迭代，包括主图框选、多级 zoom、故障域过滤、Mirror Chart 混部对比，以及把页面从早期仪表盘式布局收敛成当前 Cockpit 单屏布局。
      回头看，最关键的取舍是先缩小问题范围，聚焦"机器级资源热点 + 混部特征"，而不是把调度器内部状态或容器级细粒度时序同时塞进一个页面；
      这个取舍让页面能够围绕同一组问题形成完整叙事，也让说明文档与图表之间保持一一对应。
    </p>
  `;
}
