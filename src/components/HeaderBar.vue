<script setup lang="ts">
import { computed } from 'vue';
import { METRIC_META } from '../core/constants';
import type { MetricId } from '../core/types';
import { formatWindow } from '../core/utils';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();

const metrics = computed(() => store.data?.manifest.metrics ?? []);

const selectionBadges = computed(() => {
  const data = store.data;
  if (!data) {
    return [];
  }
  return [
    `指标：${METRIC_META[store.metricId].label}`,
    `窗口：${formatWindow(store.timeWindow, data.manifest.binSeconds)}`,
    `机器：${store.filteredMachineIndices.length}/${store.visibleMachineIndices.length}`,
    `范围：${store.activeDomainId ? `FD-${store.activeDomainId}` : '全部故障域'}`
  ];
});

const helpText = computed(() => METRIC_META[store.metricId].description);

function selectMetric(metricId: MetricId): void {
  store.setMetric(metricId);
}

function clearScope(): void {
  store.clearScopeFilter();
}

const hasScope = computed(() => store.hasScopeFilter);
</script>

<template>
  <header class="site-header viz-header">
    <div class="header-left">
      <div class="site-badge">集群资源观察</div>
      <nav class="site-nav">
        <a href="./methodology.html">方法说明</a>
      </nav>
    </div>
    <div class="header-center">
      <div class="metric-buttons">
        <button
          v-for="metric in metrics"
          :key="metric.id"
          type="button"
          class="metric-button"
          :class="{ 'is-active': metric.id === store.metricId }"
          @click="selectMetric(metric.id)"
        >
          {{ METRIC_META[metric.id].label }}
        </button>
      </div>
      <div class="metric-help">{{ helpText }}</div>
    </div>
    <div class="header-right">
      <div class="selection-badges">
        <span v-for="badge in selectionBadges" :key="badge">{{ badge }}</span>
      </div>
      <button
        class="domain-clear"
        type="button"
        :disabled="!hasScope"
        @click="clearScope"
      >
        全部机器
      </button>
    </div>
  </header>
</template>

<style scoped>
.viz-header {
  display: grid;
  grid-template-columns: minmax(200px, auto) minmax(0, 1fr) minmax(220px, auto);
  align-items: center;
  gap: 16px;
  height: var(--header-h);
  padding: 0 16px;
  margin: 0;
  background: rgba(243, 245, 247, 0.96);
  border-bottom: 1px solid var(--line);
  position: static;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 18px;
}

.header-center {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.header-center .metric-help {
  color: var(--muted);
  font-size: 0.84rem;
  line-height: 1.4;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
}

.metric-buttons {
  display: flex;
  gap: 6px;
}

.metric-buttons .metric-button {
  min-height: 32px;
  padding: 0 10px;
  font-size: 0.86rem;
}

.header-right .selection-badges {
  flex-wrap: nowrap;
  overflow: hidden;
}

.header-right .selection-badges span {
  min-height: 26px;
  padding: 0 8px;
  font-size: 0.78rem;
}

.domain-clear {
  min-height: 30px;
  padding: 0 10px;
  font-size: 0.84rem;
}
</style>
