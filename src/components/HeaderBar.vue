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
    `窗口：${formatWindow(store.timeWindow, data.manifest.binSeconds)}`,
    `机器：${store.filteredMachineIndices.length}/${store.visibleMachineIndices.length}`,
    `范围：${store.activeDomainId ? `FD-${store.activeDomainId}` : '全部故障域'}`
  ];
});

function selectMetric(metricId: MetricId): void {
  store.setMetric(metricId);
}

function clearScope(): void {
  store.clearScopeFilter();
}

const hasScope = computed(() => store.hasScopeFilter);
</script>

<template>
  <footer class="footer-panel">
    <div class="metric-buttons">
      <button
        v-for="metric in metrics"
        :key="metric.id"
        type="button"
        class="metric-button badge"
        :class="{ 'is-active': metric.id === store.metricId }"
        @click="selectMetric(metric.id)"
      >
        <span class="badge-dot" :style="{ background: METRIC_META[metric.id].accent }"></span>
        {{ METRIC_META[metric.id].label }}
      </button>
    </div>
    
    <div class="selection-badges">
      <span v-for="badge in selectionBadges" :key="badge" class="badge-text">{{ badge }}</span>
      <button
        v-if="hasScope"
        class="domain-clear"
        type="button"
        @click="clearScope"
      >
        清除过滤
      </button>
    </div>
    
    <div class="footer-right">
      <span class="url-hash">Cluster Pulse Cockpit</span>
      <a href="./methodology.html" class="method-link">方法说明</a>
    </div>
  </footer>
</template>

<style scoped>
.footer-panel {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 14px;
  background: var(--surface);
  border-top: 1px solid var(--line);
}

.metric-buttons {
  display: flex;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
}

.badge:hover {
  background: var(--line);
}

.badge.is-active {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.selection-badges {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: 12px;
  padding-left: 16px;
  border-left: 1px solid var(--line);
}

.badge-text {
  font-size: 0.78rem;
  color: var(--muted);
}

.domain-clear {
  background: none;
  border: 1px solid var(--line-strong);
  color: var(--ink);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  cursor: pointer;
}

.domain-clear:hover {
  border-color: var(--accent);
}

.footer-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
}

.url-hash {
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
  color: var(--muted);
  font-size: 0.8rem;
}

.method-link {
  color: var(--accent);
  font-size: 0.85rem;
  text-decoration: none;
}

.method-link:hover {
  text-decoration: underline;
}
</style>
