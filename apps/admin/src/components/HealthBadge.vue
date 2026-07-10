<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full bg-white shadow-sm px-3 py-1 text-xs"
    :class="{ 'opacity-70': check.state === 'skipped' }"
    role="status"
    :aria-label="ariaLabel"
  >
    <span
      class="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
      :class="dot[check.state]"
      aria-hidden="true"
      >{{ icon[check.state] }}</span
    >
    <span class="font-medium" :class="check.state === 'skipped' ? 'text-slate-400' : 'text-slate-700'">{{
      label[check.name]
    }}</span>
    <span class="text-slate-400">{{ suffix }}</span>
    <span v-if="impact" class="text-slate-500">· {{ impact }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DisplayCheck, DisplayState, CheckName } from '../composables/useHealth'

const props = defineProps<{ check: DisplayCheck }>()

// Color + icon + text are all redundant carriers of state so the badge is
// legible without color (colorblind / grayscale safe).
const dot: Record<DisplayState, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
  skipped: 'bg-slate-300',
}
const icon: Record<DisplayState, string> = { ok: '✓', degraded: '▲', down: '✕', skipped: '–' }
const label: Record<CheckName, string> = {
  database: 'Datenbank',
  redis: 'Warteschlange',
  coingecko: 'Preisdaten',
  smtp: 'E-Mail-Versand',
}
const stateWord: Record<DisplayState, string> = {
  ok: 'betriebsbereit',
  degraded: 'langsam',
  down: 'nicht erreichbar',
  skipped: 'nicht konfiguriert',
}
const impactDown: Record<CheckName, string> = {
  database: 'Kernsystem nicht erreichbar',
  redis: 'Hintergrund-Sync pausiert',
  coingecko: 'Preise können veraltet sein',
  smtp: 'E-Mails werden nicht zugestellt',
}
const impactDegraded: Partial<Record<CheckName, string>> = { coingecko: 'Preisabruf langsam' }

const suffix = computed(() => {
  const { state, latencyMs } = props.check
  if (state === 'ok') return latencyMs !== null ? `${latencyMs}ms` : ''
  if (state === 'degraded') return latencyMs !== null ? `langsam · ${latencyMs}ms` : 'langsam'
  if (state === 'down') return 'nicht erreichbar'
  return 'nicht konfiguriert'
})

const impact = computed(() => {
  if (props.check.state === 'down') return impactDown[props.check.name]
  if (props.check.state === 'degraded') return impactDegraded[props.check.name] ?? null
  return null
})

const ariaLabel = computed(() => {
  const { name, state, latencyMs } = props.check
  const parts = [`${label[name]}: ${stateWord[state]}`]
  if (latencyMs !== null && (state === 'ok' || state === 'degraded')) parts.push(`${latencyMs}ms`)
  if (impact.value) parts.push(impact.value)
  return parts.join(', ')
})
</script>
