<template>
  <!-- Cold load: skeleton pills, never an empty gap. -->
  <div v-if="loading" class="flex flex-wrap items-center gap-2 mb-6">
    <span v-for="i in 4" :key="i" class="h-7 w-32 rounded-full bg-slate-100 animate-pulse" />
  </div>
  <!-- Stale tick dims the row so last-known values don't read as live. -->
  <div
    v-else
    class="flex flex-wrap items-center gap-2 mb-6 transition-opacity"
    :class="{ 'opacity-50': stale }"
  >
    <HealthBadge v-for="c in checks" :key="c.name" :check="c" />
  </div>
</template>

<script setup lang="ts">
import type { DisplayCheck } from '../composables/useHealth'
import HealthBadge from './HealthBadge.vue'

defineProps<{ checks: DisplayCheck[]; stale?: boolean; loading?: boolean }>()
</script>
