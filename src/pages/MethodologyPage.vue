<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Tooltip from '../components/Tooltip.vue';
import { useTermTooltips } from '../composables/useTermTooltips';
import { loadInitialData } from '../core/data';
import { renderMethodologyMarkup } from '../core/templates';
import type { AppData } from '../core/types';

const data = ref<AppData | null>(null);
const errorMessage = ref('');
const articleRef = ref<HTMLElement | null>(null);

useTermTooltips(articleRef);

onMounted(async () => {
  document.body.classList.add('methodology-page');
  try {
    data.value = await loadInitialData();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unknown bootstrap error';
  }
});

onBeforeUnmount(() => {
  document.body.classList.remove('methodology-page');
});
</script>

<template>
  <Tooltip />
  <div v-if="errorMessage" class="page-shell">
    <div class="error-panel">
      <strong>数据加载失败</strong>
      <p>{{ errorMessage }}</p>
      <p>请先运行 <code>npm run data</code> 或 <code>npm run data:sample</code> 生成 <code>public/data</code>。</p>
    </div>
  </div>
  <div v-else-if="data" class="methodology-shell">
    <header class="site-header">
      <div class="site-badge">集群资源观察 · 方法说明</div>
      <nav class="site-nav">
        <a href="./">返回主图</a>
      </nav>
    </header>
    <main class="methodology-body">
      <section class="section-heading">
        <div class="eyebrow">方法说明</div>
        <h2>问题、方法与数据来源</h2>
      </section>
      <article
        ref="articleRef"
        class="method-article"
        v-html="renderMethodologyMarkup(data, data.hotspots.highlights[0])"
      />
    </main>
  </div>
</template>

<style scoped>
.methodology-shell {
  width: min(960px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 18px 0 72px;
}

.methodology-body {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}
</style>
