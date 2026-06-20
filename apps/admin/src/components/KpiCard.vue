<template>
  <div class="bg-white rounded-lg shadow-sm p-4">
    <div class="text-sm text-slate-500">{{ label }}</div>
    <div class="text-2xl font-semibold text-slate-800 mt-1">{{ value }}</div>
    <div class="mt-1 flex items-center gap-1 text-xs">
      <span v-if="delta !== undefined && delta !== null" :class="delta >= 0 ? 'text-emerald-600' : 'text-red-600'">
        {{ delta >= 0 ? '▲' : '▼' }} {{ Math.abs(delta) }}%
      </span>
      <span v-if="sub" class="text-slate-400">{{ sub }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string | number; sub?: string; delta?: number | null }>()
</script>
