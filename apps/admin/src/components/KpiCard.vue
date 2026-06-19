<template>
  <div class="bg-white rounded-lg shadow-sm p-4">
    <div class="text-sm text-slate-500">{{ label }}</div>
    <div class="text-2xl font-semibold text-slate-800 mt-1">{{ value }}</div>
    <div v-if="sub" class="text-xs text-slate-400 mt-1">{{ sub }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string | number; sub?: string }>()
</script>
