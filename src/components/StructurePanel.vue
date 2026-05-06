<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTooltip } from '../composables/useTooltip';
import { renderIcicle, renderScatter, renderCorrelationMatrix } from '../core/draw/structure';
import { detectWebGLCapability, evaluateScatterWebGL, type WebGLAssessment, type WebGLCapability } from '../core/rendering-strategy';
import { useVisualizationStore } from '../stores/visualization';
import type { MetricId } from '../core/types';
import { METRIC_META } from '../core/constants';

const store = useVisualizationStore();
const tooltip = useTooltip();

const containerRef = ref<HTMLElement | null>(null);
const scatterSvgRef = ref<SVGSVGElement | null>(null);
const domainSvgRef = ref<SVGSVGElement | null>(null);
const correlationCanvasRef = ref<HTMLCanvasElement | null>(null);

const scatterCaption = ref('');
const scatterPair = ref<[MetricId, MetricId]>(['cpu', 'memory']);
const showCorrelation = ref(true);
const webglCapability = ref<WebGLCapability>({
  available: false,
  version: 'none',
  maxTextureSize: 0,
  renderer: null
});
const scatterWebGLAssessment = ref<WebGLAssessment | null>(null);

const hasDomainScope = computed(() => Boolean(store.activeDomainId));
const scatterRendererBadge = computed(() => {
  const assessment = scatterWebGLAssessment.value;
  if (!assessment) {
    return '评估中';
  }
  return assessment.recommendedRenderer === 'd3-svg' ? 'D3/SVG' : 'WebGL';
});
const scatterRendererTitle = computed(() => {
  const assessment = scatterWebGLAssessment.value;
  if (!assessment) {
    return '正在评估散点图渲染策略';
  }
  return [
    `渲染点数 ${assessment.renderedPrimitiveCount}`,
    `候选点数 ${assessment.candidatePrimitiveCount}`,
    `风险 ${assessment.riskLevel}`,
    `WebGL ${webglCapability.value.available ? webglCapability.value.version : '不可用'}`,
    ...assessment.reasons
  ].join('；');
});

function clearDomain(): void {
  store.setActiveDomain(null);
}

function redrawScatter(): void {
  const svg = scatterSvgRef.value;
  if (!svg) {
    return;
  }
  scatterWebGLAssessment.value = evaluateScatterWebGL({
    renderedPointCount: store.windowMachineStats.length,
    candidatePointCount: store.data?.manifest.machineCount,
    webgl: webglCapability.value
  });
  scatterCaption.value = renderScatter(
    svg,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    store.windowMachineStats,
    {
      showTooltip: (x, y, html) => tooltip.show(x, y, html),
      hideTooltip: () => tooltip.hide(),
      onSelectMachine: (index) => store.setSelectedMachine(index)
    },
    scatterPair.value
  );
}

function redrawDomain(): void {
  const svg = domainSvgRef.value;
  if (!svg) {
    return;
  }
  renderIcicle(
    svg,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    store.windowMachineStats,
    {
      showTooltip: (x, y, html) => tooltip.show(x, y, html),
      hideTooltip: () => tooltip.hide(),
      onToggleDomain: (domainId) => store.toggleDomain(domainId)
    }
  );
}

function redrawCorrelation(): void {
  const canvas = correlationCanvasRef.value;
  if (!canvas) {
    return;
  }
  
  // Set resolution based on element size
  const dpr = window.devicePixelRatio || 1;
  // Use a fixed physical layout size for the floating inset
  canvas.width = 150 * dpr;
  canvas.height = 150 * dpr;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
  }

  renderCorrelationMatrix(
    canvas,
    store.windowMachineStats,
    {
      onSelectPair: (pair) => {
        scatterPair.value = pair;
      },
      showTooltip: (x, y, html) => tooltip.show(x, y, html),
      hideTooltip: () => tooltip.hide()
    }
  );
}

function redrawAll(): void {
  redrawScatter();
  redrawDomain();
  redrawCorrelation();
}

let resizeObserver: ResizeObserver | null = null;

watch(
  () => [store.metricId, store.windowMachineStats, store.activeDomainId, store.selectedMachineIndex] as const,
  () => {
    redrawAll();
  },
  { flush: 'post' }
);

watch(scatterPair, () => {
  redrawScatter();
});

onMounted(() => {
  webglCapability.value = detectWebGLCapability();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => redrawAll());
    resizeObserver.observe(containerRef.value);
  }
  redrawAll();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <section ref="containerRef" class="panel structure-panel">
    <div class="struct-top">
      <div class="sub-header">
        <div>
          <span class="label">故障域层级</span>
          <strong>FD1 → FD2 → 机器分布</strong>
        </div>
        <button
          class="domain-clear"
          type="button"
          :disabled="!hasDomainScope"
          @click="clearDomain"
        >
          清除故障域过滤
        </button>
      </div>
      <svg ref="domainSvgRef" class="chart-svg domain-svg" />
    </div>

    <div class="struct-bottom">
      <div class="sub-header">
        <div>
          <span class="label">散点密度与相关性</span>
          <strong>{{ METRIC_META[scatterPair[0]].label }} 与 {{ METRIC_META[scatterPair[1]].label }} 分布</strong>
        </div>
        <div style="display: flex; align-items: baseline; gap: 12px;">
          <span class="caption">{{ scatterCaption }}</span>
          <span class="renderer-badge" :class="`risk-${scatterWebGLAssessment?.riskLevel ?? 'low'}`" :title="scatterRendererTitle">
            {{ scatterRendererBadge }}
          </span>
          <button
            class="domain-clear"
            type="button"
            @click="showCorrelation = !showCorrelation"
          >
            {{ showCorrelation ? '隐藏矩阵' : '显示矩阵' }}
          </button>
        </div>
      </div>
      <div class="bottom-content">
        <svg ref="scatterSvgRef" class="chart-svg scatter-svg" />
        <canvas v-show="showCorrelation" ref="correlationCanvasRef" class="chart-canvas correlation-canvas"></canvas>
      </div>
    </div>
  </section>
</template>

<style scoped>
.structure-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 12px;
  min-width: 0;
  min-height: 0;
}

.struct-top, .struct-bottom {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.struct-top {
  flex: 1;
}

.struct-bottom {
  flex: 1.5;
}

.sub-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.sub-header .label {
  display: block;
  margin-bottom: 2px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sub-header strong {
  font-size: 0.98rem;
}

.sub-header .caption {
  color: var(--muted);
  font-size: 0.78rem;
}

.renderer-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 0.72rem;
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
}

.renderer-badge.risk-medium {
  color: #73510f;
  background: #fff7db;
  border-color: #e7cc74;
}

.renderer-badge.risk-high {
  color: #7c2d2d;
  background: #fff1f1;
  border-color: #efb8b8;
}

.chart-svg {
  width: 100%;
  height: 100%;
  display: block;
  min-height: 0;
}

.bottom-content {
  position: relative;
  flex: 1;
  min-height: 0;
}

.scatter-svg {
  width: 100%;
  height: 100%;
}

.correlation-canvas {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 150px;
  height: 150px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(4px);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.domain-clear {
  min-height: 28px;
  padding: 0 10px;
  font-size: 0.8rem;
}
</style>
