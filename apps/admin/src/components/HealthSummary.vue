<template>
  <div class="flex items-center justify-between flex-wrap gap-2 mb-2">
    <!-- Overall verdict: the <10s read, above the individual badges. -->
    <span class="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
      <span class="h-2.5 w-2.5 rounded-full" :class="[verdictDot, overall.level === 'loading' ? 'animate-pulse' : '']" />
      {{ overall.label }}
    </span>
    <div class="flex items-center gap-3 text-xs">
      <span :class="isStale ? 'text-amber-600' : 'text-slate-500'">{{ timestamp }}</span>
      <button
        class="rounded border border-slate-300 px-2.5 py-1 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="refreshing"
        :aria-busy="refreshing"
        @click="$emit('refresh')"
      >
        {{ refreshing ? 'Aktualisiere …' : 'Aktualisieren' }}
      </button>
    </div>
    <span class="sr-only" role="status" aria-live="polite">{{ liveMsg }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Overall, OverallLevel } from '../composables/useHealth'

const props = defineProps<{
  overall: Overall
  lastSuccessAt: Date | null
  isStale: boolean
  refreshing: boolean
}>()

defineEmits<{ refresh: [] }>()

const verdictDots: Record<OverallLevel, string> = {
  ok: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
  skipped: 'bg-slate-400',
  loading: 'bg-slate-300',
}
const verdictDot = computed(() => verdictDots[props.overall.level])

function time(d: Date): string {
  return d.toLocaleTimeString('de-DE')
}

const timestamp = computed(() => {
  if (!props.lastSuccessAt) return ''
  const t = time(props.lastSuccessAt)
  return props.isStale ? `⚠ Stand veraltet · letzte Prüfung ${t}` : `Stand ${t}`
})

const liveMsg = computed(() => {
  if (props.isStale) return 'Aktualisierung fehlgeschlagen, Anzeige veraltet'
  if (props.lastSuccessAt) return `Systemstatus aktualisiert um ${time(props.lastSuccessAt)}`
  return ''
})
</script>
