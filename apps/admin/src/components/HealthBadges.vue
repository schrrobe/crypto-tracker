<template>
  <div v-if="data" class="flex flex-wrap items-center gap-2 mb-6">
    <span
      v-for="c in data.checks"
      :key="c.name"
      class="inline-flex items-center gap-1.5 rounded-full bg-white shadow-sm px-3 py-1 text-xs"
      :title="c.detail ?? ''"
    >
      <span class="h-2 w-2 rounded-full" :class="dot[c.state]" />
      <span class="font-medium">{{ labels[c.name] }}</span>
      <span v-if="c.latencyMs !== null" class="text-slate-400">{{ c.latencyMs }}ms</span>
      <span v-else class="text-slate-400">{{ stateLabel[c.state] }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import type { AdminHealthDto, HealthState } from '@crypto-tracker/shared'

defineProps<{ data: AdminHealthDto | null }>()

const dot: Record<HealthState, string> = {
  ok: 'bg-emerald-500',
  down: 'bg-red-500',
  skipped: 'bg-slate-300',
}
const stateLabel: Record<HealthState, string> = { ok: '', down: 'down', skipped: 'n/a' }
const labels: Record<string, string> = {
  database: 'Datenbank',
  redis: 'Redis',
  coingecko: 'CoinGecko',
  smtp: 'SMTP',
}
</script>
