<script setup lang="ts">
import { provide, ref } from 'vue';
import { TooltipKey, type TooltipApi } from '../composables/useTooltip';

const visible = ref(false);
const html = ref('');
const x = ref(0);
const y = ref(0);
const transform = ref('translate(14px, 14px)');

const TOOLTIP_WIDTH = 280;
const TOOLTIP_HEIGHT = 150; // 保守估算
const GAP = 14;

const api: TooltipApi = {
  show: (nextX, nextY, nextHtml) => {
    html.value = nextHtml;
    x.value = nextX;
    y.value = nextY;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 边界检测：判断 tooltip 应该向哪个方向展开
    let tx = GAP;
    let ty = GAP;

    // 右侧出界 → 向左展开
    if (nextX + TOOLTIP_WIDTH + GAP * 2 > vw) {
      tx = -(TOOLTIP_WIDTH + GAP);
    }

    // 底部出界 → 向上展开
    if (nextY + TOOLTIP_HEIGHT + GAP * 2 > vh) {
      ty = -(TOOLTIP_HEIGHT + GAP);
    }

    transform.value = `translate(${tx}px, ${ty}px)`;
    visible.value = true;
  },
  hide: () => {
    visible.value = false;
  }
};

provide(TooltipKey, api);
</script>

<template>
  <slot />
  <div
    class="tooltip"
    :class="{ 'is-visible': visible }"
    :style="{
      left: `${x}px`,
      top: `${y}px`,
      transform: transform
    }"
    v-html="html"
  />
</template>
