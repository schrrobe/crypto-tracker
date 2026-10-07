<template>
  <section v-if="segments.length > 0" class="allocation" data-testid="allocation-donut" aria-labelledby="allocation-title">
    <div class="section-head">
      <h2 id="allocation-title" class="section-title">{{ $t('ui.holdings.allocation') }}</h2>
    </div>
    <!-- Length is exactly share: the bar is strictly proportional -->
    <div class="bar" role="img" :aria-label="ariaLabel">
      <span
        v-for="(s, i) in segments"
        :key="s.label"
        class="seg"
        :style="{ flexGrow: s.percent, background: color(i, s.rest) }"
      />
    </div>
    <ul class="legend">
      <li v-for="(s, i) in segments" :key="s.label" :data-testid="`allocation-${s.label}`">
        <span class="swatch" :style="{ background: color(i, s.rest) }" aria-hidden="true" />
        <span class="name">{{ s.label }}</span>
        <span class="fig pct">{{ formatPercent(s.percent) }}</span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PortfolioAssetPosition } from '@crypto-tracker/shared'
import { intlLocale, t } from '../i18n'

const props = defineProps<{ positions: PortfolioAssetPosition[] }>()

const TOP_N = 5

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)} %`
}

function color(index: number, rest: boolean): string {
  return rest ? 'var(--app-series-rest)' : `var(--app-series-${(index % 5) + 1})`
}

const segments = computed(() => {
  const priced = props.positions
    .filter((p) => p.valueEur !== null && Number(p.valueEur) > 0)
    .sort((a, b) => Number(b.valueEur) - Number(a.valueEur))
  const total = priced.reduce((sum, p) => sum + Number(p.valueEur), 0)
  if (total <= 0) return []
  const top = priced.slice(0, TOP_N)
  const restValue = priced.slice(TOP_N).reduce((sum, p) => sum + Number(p.valueEur), 0)
  return [
    ...top.map((p) => ({ label: p.asset.symbol, percent: (Number(p.valueEur) / total) * 100, rest: false })),
    ...(restValue > 0 ? [{ label: t('dashboard.others'), percent: (restValue / total) * 100, rest: true }] : []),
  ]
})

const ariaLabel = computed(
  () =>
    `${t('ui.holdings.allocation')}: ${segments.value.map((s) => `${s.label} ${formatPercent(s.percent)}`).join(', ')}`,
)
</script>

<style scoped>
.bar {
  display: flex;
  gap: 2px;
  height: 14px;
  border-radius: 3px;
  overflow: hidden;
}
.seg {
  flex-basis: 0;
  min-width: 2px;
}
.legend {
  list-style: none;
  margin: var(--app-space-3) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--app-space-1) var(--app-space-4);
}
.legend li {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  min-height: 28px;
  font-size: var(--app-text-sm);
}
.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex: none;
}
.name {
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}
.pct {
  margin-left: auto;
  color: var(--app-ink-2);
}
</style>
