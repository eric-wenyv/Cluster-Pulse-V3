<script setup lang="ts">
import { provide, ref } from 'vue';
import { TooltipKey, type TooltipApi } from '../composables/useTooltip';

const visible = ref(false);
const html = ref('');
const x = ref(0);
const y = ref(0);

const api: TooltipApi = {
  show: (nextX, nextY, nextHtml) => {
    html.value = nextHtml;
    x.value = nextX;
    y.value = nextY;
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
    :style="{ left: `${x}px`, top: `${y}px` }"
    v-html="html"
  />
</template>
