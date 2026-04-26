import { TERM_EXPLANATIONS } from './constants';
import type { AppData, Hotspot } from './types';
import { renderTerm } from './utils';

export function renderMethodologyMarkup(data: AppData, leadHighlight: Hotspot | undefined): string {
  return `
    <h3>可视化方案要解答什么问题</h3>
    <p>
      这个可视化围绕一个具体而可检验的问题展开：在 Alibaba 2018 集群的 8 天 ${renderTerm('trace', TERM_EXPLANATIONS.trace)} 中，CPU、内存、网络与磁盘压力何时出现，
      热点是零散分布在少数机器上，还是集中在某些${renderTerm('故障域', TERM_EXPLANATIONS.failureDomain)}中，以及被选中的机器在完整周期里究竟表现为短时尖峰、持续高负载，
      还是多种资源同时抬升。
    </p>
    <p>
      因此，主热力图负责回答“热点发生在什么时候、落在哪些机器上”，中段的散点图与故障域条形图负责回答“当前窗口里的热点是否集中成簇”，
      下方单机四条资源曲线则负责回答“某台机器的热点究竟是什么形态”。三个视图对应的是同一个问题的全局、局部和解释三个层次。
    </p>
    <h3>设计决策依据、替代方案与最终取舍</h3>
    <p>
      页面结构采用三象限单屏布局，主热力图占据左侧 8 列、纵贯两行，右侧上方为故障域排行与机器分布散点，右侧下方为选中机器的四指标小型多重图。
      这种布局参考了 ${renderTerm('MBTA Viz', TERM_EXPLANATIONS.mbtaViz)} 把多种视图编排在同一画面上的做法，方便在 1440×900 视口里同时观察全局、局部和解释三个层次。
    </p>
    <p>
      主图最终选择热力图，而没有采用多折线、堆叠面积图或汇总柱图。原因是这个任务必须同时保留连续时间轴和按故障域排序后的机器分布；
      若改用折线，机器数量一多就会严重遮挡；若只做汇总柱图，虽然便于比较均值，却会丢失热点是“成片出现”还是“局部闪现”的结构信息。
      右上象限采用 CPU 对内存的散点图，是为了把当前时间窗内的机器分布投影到一个便于比较的位置图上，再用点大小编码当前指标峰值，从而区分
      “均值偏高”和“峰值突刺”两类不同状态。故障域部分使用条形图而不是 ${renderTerm('treemap', TERM_EXPLANATIONS.treemap)} 或饼图，是因为这里更关心排序与集中度，而不是面积占比。
    </p>
    <p>
      交互上最终保留了指标切换、主图框选、故障域过滤和机器点击四类操作。也考虑过只保留底部时间轴 ${renderTerm('brush', TERM_EXPLANATIONS.brush)} 的方案，但那样无法直接在主图里同时选择
      时间与机器范围；也考虑过更复杂的筛选菜单，但会打断阅读路径。最终版本选择在主热力图上直接框选，再让散点图与单机曲线同步联动，
      以减少界面跳转成本。${leadHighlight ? `页面默认聚焦 ${leadHighlight.title}，也是为了让首次进入页面的读者立即看到一个真实的热点窗口。` : '页面默认从全局最强热点窗口开始，避免首屏停留在过于平缓的状态。'}
    </p>
    <h3>外部资源引用</h3>
    <p>
      数据源来自 Alibaba Cluster Trace 2018，本项目实际使用的是其中的 ${renderTerm('machine_meta', TERM_EXPLANATIONS.machineMeta)} 与 ${renderTerm('machine_usage', TERM_EXPLANATIONS.machineUsage)} 两张表。页面中的静态数据并非手工构造示例，
      而是由脚本下载原始数据后按 15 分钟时间窗聚合生成，再部署到 ${renderTerm('GitHub Pages', TERM_EXPLANATIONS.githubPages)}。
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
      当前版本按单人项目推进，数据处理、前端实现、交互联动、样式调整与 GitHub Pages 部署均由同一人完成。如果按工时估算，
      从方案确定、数据脚本编写、前端实现到上线整理大约花费 25 到 35 小时，其中最耗时的并不是基础页面搭建，而是两类工作：
      一类是把原始 trace 清洗并压缩成适合静态网页加载的结构，另一类是反复调整主热力图和联动交互，使页面在 GitHub Pages 环境下既能显示真实数据，
      又不至于过于卡顿。
    </p>
    <p>
      开发过程前期主要时间投入在数据管线和指标定义上，例如如何处理缺失值、如何定义热点、如何在 ${renderTerm('sample', TERM_EXPLANATIONS.sample)} 与 ${renderTerm('full', TERM_EXPLANATIONS.full)} 两种模式之间共享统一输出接口。
      中后期则主要花在交互和版式迭代，包括主图框选、故障域过滤，以及把页面从仪表盘式布局收敛成单屏三象限布局。回头看，最关键的取舍
      是先缩小问题范围，只做机器级资源热点，而不是把容器、批处理任务和调度关系同时塞进一个页面里；这个取舍让页面能够围绕同一个问题形成完整叙事，
      也让说明文档与图表之间保持一一对应。
    </p>
  `;
}
