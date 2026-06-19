<template>
  <div class="bg-white rounded-lg shadow-sm p-4">
    <h3 class="text-sm font-medium text-slate-600 mb-3">{{ title }}</h3>
    <p v-if="items.length === 0" class="text-sm text-slate-400">Keine Daten.</p>
    <div v-for="item in items" :key="item.key" class="mb-2 last:mb-0">
      <div class="flex justify-between text-xs text-slate-600 mb-0.5">
        <span class="truncate">{{ item.key }}</span>
        <span class="tabular-nums">{{ item.count }}</span>
      </div>
      <div class="h-2 bg-slate-100 rounded">
        <div class="h-2 bg-slate-700 rounded" :style="{ width: pct(item.count) + '%' }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ title: string; items: { key: string; count: number }[] }>()
const max = computed(() => Math.max(1, ...props.items.map((i) => i.count)))
function pct(n: number): number {
  return Math.round((n / max.value) * 100)
}
</script>
