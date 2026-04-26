<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { renderMachineDetail } from '../core/draw/machine-detail';
import type { MachineRecord } from '../core/types';
import { useVisualizationStore } from '../stores/visualization';

const store = useVisualizationStore();

const containerRef = ref<HTMLElement | null>(null);
const multiplesRef = ref<HTMLDivElement | null>(null);

const activeMachine = computed<MachineRecord | null>(() => {
  const data = store.data;
  if (!data) {
    return null;
  }
  const candidate = store.selectedMachineIndex;
  if (candidate !== null) {
    const direct = data.machines.machines.find((machine) => machine.index === candidate);
    if (direct) {
      return direct;
    }
  }
  const fallbackIndex = store.windowMachineStats[0]?.machineIndex ?? null;
  if (fallbackIndex !== null) {
    return data.machines.machines.find((machine) => machine.index === fallbackIndex) ?? null;
  }
  return data.machines.machines[0] ?? null;
});

const title = computed(() => {
  const machine = activeMachine.value;
  if (!machine) {
    return '等待加载';
  }
  return `${machine.machineId} · FD-${machine.failureDomain1}`;
});

const subtitle = computed(() => {
  const machine = activeMachine.value;
  if (!machine) {
    return '';
  }
  return `CPU ${machine.cpuNum} 核 · 内存 ${machine.memSize} 归一化单位 · 状态 ${machine.status}`;
});

function redraw(): void {
  const data = store.data;
  const grid = store.grid;
  const container = multiplesRef.value;
  const machine = activeMachine.value;
  if (!data || !grid || !container || !machine) {
    if (container && (!data || !grid || !machine)) {
      container.innerHTML = '';
    }
    return;
  }
  renderMachineDetail(
    container,
    data,
    grid,
    {
      metricId: store.metricId,
      timeWindow: store.timeWindow,
      activeDomainId: store.activeDomainId,
      selectedMachineIndex: store.selectedMachineIndex,
      machineFilterIndices: store.machineFilterIndices
    },
    machine
  );
}

let resizeObserver: ResizeObserver | null = null;

watch(
  () => [activeMachine.value?.index, store.metricId, store.timeWindow[0], store.timeWindow[1], store.grid] as const,
  () => {
    redraw();
  },
  { flush: 'post' }
);

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => redraw());
    resizeObserver.observe(containerRef.value);
  }
  redraw();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <section ref="containerRef" class="panel detail-panel">
    <div class="detail-header">
      <div>
        <span class="label">选中机器</span>
        <strong>{{ title }}</strong>
      </div>
      <span class="subtitle">{{ subtitle }}</span>
    </div>
    <div ref="multiplesRef" class="small-multiples" />
  </section>
</template>

<style scoped>
.detail-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  height: 100%;
  padding: 12px;
  min-width: 0;
  min-height: 0;
}

.detail-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-header .label {
  display: block;
  margin-bottom: 2px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.detail-header strong {
  font-size: 1rem;
}

.detail-header .subtitle {
  color: var(--muted);
  font-size: 0.82rem;
}

.small-multiples {
  display: grid;
  grid-template-rows: repeat(4, minmax(0, 1fr));
  gap: 6px;
  min-height: 0;
}

:deep(.small-metric) {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface-soft);
  min-height: 0;
}

:deep(.small-metric .label) {
  display: block;
  margin-bottom: 2px;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

:deep(.small-metric svg) {
  width: 100%;
  height: 100%;
  display: block;
  min-height: 0;
}
</style>
