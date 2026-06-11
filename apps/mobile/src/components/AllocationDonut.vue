<template>
  <ion-card v-if="segments.length > 0" data-testid="allocation-donut">
    <ion-card-header>
      <ion-card-subtitle>{{ $t('dashboard.allocation') }}</ion-card-subtitle>
    </ion-card-header>
    <ion-card-content class="donut-wrap">
      <svg viewBox="0 0 42 42" class="donut" role="img">
        <circle
          v-for="segment in segments"
          :key="segment.label"
          cx="21"
          cy="21"
          r="15.915"
          fill="transparent"
          :stroke="segment.color"
          stroke-width="6"
          :stroke-dasharray="`${segment.percent} ${100 - segment.percent}`"
          :stroke-dashoffset="segment.offset"
        />
      </svg>
      <ul class="legend">
        <li v-for="segment in segments" :key="segment.label" :data-testid="`allocation-${segment.label}`">
          <span class="dot" :style="{ background: segment.color }" />
          {{ segment.label }}
          <span class="pct amount">{{ formatPercent(segment.percent) }}</span>
        </li>
      </ul>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import { IonCard, IonCardContent, IonCardHeader, IonCardSubtitle } from '@ionic/vue'
import { computed } from 'vue'
import type { PortfolioAssetPosition } from '@crypto-tracker/shared'
import { intlLocale, t } from '../i18n'

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)} %`
}

const props = defineProps<{ positions: PortfolioAssetPosition[] }>()

const COLORS = ['#4f6ef7', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b']
const TOP_N = 5

const segments = computed(() => {
  const priced = props.positions.filter((p) => p.valueEur !== null && Number(p.valueEur) > 0)
  const total = priced.reduce((sum, p) => sum + Number(p.valueEur), 0)
  if (total <= 0) return []

  const top = priced.slice(0, TOP_N)
  const restValue = priced.slice(TOP_N).reduce((sum, p) => sum + Number(p.valueEur), 0)
  const entries = [
    ...top.map((p) => ({ label: p.asset.symbol, value: Number(p.valueEur) })),
    ...(restValue > 0 ? [{ label: t('dashboard.others'), value: restValue }] : []),
  ]

  // stroke-dasharray-Donut: Umfang = 100, Offset 25 startet oben (12 Uhr)
  let consumed = 0
  return entries.map((entry, index) => {
    const percent = (entry.value / total) * 100
    const segment = {
      label: entry.label,
      percent,
      offset: 25 - consumed,
      color: COLORS[index % COLORS.length] as string,
    }
    consumed += percent
    return segment
  })
})
</script>

<style scoped>
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
}
.donut {
  width: 120px;
  min-width: 120px;
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 0.85em;
  flex: 1;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.pct {
  margin-left: auto;
  color: var(--ion-color-medium);
}
</style>
