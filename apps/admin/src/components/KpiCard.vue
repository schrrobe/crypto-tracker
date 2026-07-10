<template>
  <div class="bg-white rounded-lg shadow-sm p-4">
    <div class="text-sm text-slate-500">{{ label }}</div>
    <div class="text-2xl font-semibold text-slate-800 mt-1">{{ value }}</div>
    <div class="mt-1 flex items-center gap-1 text-xs">
      <!-- delta === undefined: card has no delta concept, render nothing.
           delta === null: previous period was 0 → "neu" (growth from zero baseline).
           delta === 0: no change, neutral. Otherwise colour by polarity, not direction. -->
      <span v-if="delta === null" class="text-slate-500" title="keine Vorperiode zum Vergleich">neu</span>
      <span v-else-if="delta !== undefined" :class="deltaClass">
        <span aria-hidden="true">{{ arrow }}</span>
        <span class="sr-only">{{ delta > 0 ? 'gestiegen um' : delta < 0 ? 'gesunken um' : 'unverändert' }}</span>
        {{ Math.abs(delta) }}%
      </span>
      <span v-if="sub" class="text-slate-500">{{ sub }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

// polarity decouples colour from direction: for churn-type KPIs a rising number
// is BAD, so green must not mean "up". 'neutral' never colours the delta.
const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    delta?: number | null
    polarity?: 'up-good' | 'up-bad' | 'neutral'
  }>(),
  { polarity: 'up-good' },
)

const arrow = computed(() => (props.delta! > 0 ? '▲' : props.delta! < 0 ? '▼' : '•'))

const deltaClass = computed(() => {
  const d = props.delta!
  if (d === 0 || props.polarity === 'neutral') return 'text-slate-500'
  const good = props.polarity === 'up-good' ? d > 0 : d < 0
  return good ? 'text-emerald-600' : 'text-red-600'
})
</script>
