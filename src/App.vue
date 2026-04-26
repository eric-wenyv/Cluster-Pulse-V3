<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppStatus from './components/AppStatus.vue';
import HeaderBar from './components/HeaderBar.vue';
import HeatmapPanel from './components/HeatmapPanel.vue';
import MachineDetailPanel from './components/MachineDetailPanel.vue';
import StructurePanel from './components/StructurePanel.vue';
import Tooltip from './components/Tooltip.vue';
import { useHashSync } from './composables/useHashSync';
import { useTermTooltips } from './composables/useTermTooltips';
import { useVisualizationStore } from './stores/visualization';

const store = useVisualizationStore();
const errorMessage = ref('');
const ready = computed(() => Boolean(store.data));
const rootRef = ref<HTMLElement | null>(null);

useHashSync();
useTermTooltips(rootRef);

onMounted(async () => {
  try {
    await store.bootstrap();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unknown bootstrap error';
  }
});
</script>

<template>
  <Tooltip />
  <AppStatus v-if="errorMessage" :message="errorMessage" />
  <div v-else-if="ready" ref="rootRef" class="viz-shell">
    <HeaderBar />
    <main class="viz-grid">
      <HeatmapPanel class="q-heatmap panel-cell" />
      <StructurePanel class="q-structure panel-cell" />
      <MachineDetailPanel class="q-detail panel-cell" />
    </main>
  </div>
</template>
