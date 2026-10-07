<template>
  <section v-if="visible" class="chart-block" data-testid="portfolio-chart" :aria-label="$t('dashboard.history')">
    <p
      v-if="deltaPercent !== null && points.length >= 2"
      class="change"
      :class="deltaClass"
      data-testid="chart-delta"
    >
      <ion-icon v-if="deltaClass !== 'flat'" :icon="deltaClass === 'gain' ? arrowUp : arrowDown" aria-hidden="true" />
      <span class="sr-only">{{ deltaWord }}</span>
      <span class="fig">{{ deltaAmount }}</span>
      <span class="fig pct">({{ formatDelta(deltaPercent) }})</span>
      <span class="since">{{ $t(`ui.overview.changeSince.${range}`) }}</span>
    </p>

    <div class="plot">
      <div v-if="loading" class="chart-state" aria-busy="true">
        <ion-skeleton-text animated class="plot-skeleton" />
      </div>
      <div v-else-if="error" class="chart-state" data-testid="chart-error" role="status">
        <p class="muted">{{ $t('dashboard.historyError') }}</p>
        <ion-button size="small" fill="outline" @click="load">{{ $t('common.retry') }}</ion-button>
      </div>
      <template v-else-if="points.length >= 2">
        <svg viewBox="0 0 300 90" class="chart" preserveAspectRatio="none" role="img" :aria-label="chartLabel">
          <path :d="areaPath" class="area" />
          <path :d="linePath" class="line" fill="none" />
        </svg>
        <div class="axis fig" aria-hidden="true">
          <span>{{ formatCurrency(firstValue, currency) }}</span>
          <span>{{ formatCurrency(lastValue, currency) }}</span>
        </div>
      </template>
      <div v-else class="chart-state" data-testid="chart-empty">
        <p class="muted">{{ $t('dashboard.historyEmpty') }}</p>
      </div>
    </div>

    <ion-segment :value="range" class="ranges" :aria-label="$t('dashboard.history')" @ionChange="onRangeChange($event)">
      <ion-segment-button value="24h" data-testid="chart-range-24h">
        <ion-label>{{ $t('dashboard.range24h') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="7d" data-testid="chart-range-7d">
        <ion-label>{{ $t('dashboard.range7d') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="30d" data-testid="chart-range-30d">
        <ion-label>{{ $t('dashboard.range30d') }}</ion-label>
      </ion-segment-button>
      <ion-segment-button value="1y" data-testid="chart-range-1y">
        <ion-label>
          {{ $t('dashboard.range1y') }}
          <ion-icon v-if="!auth.isPro" :icon="lockClosedOutline" class="lock" aria-hidden="true" />
          <span v-if="!auth.isPro" class="sr-only">(Pro)</span>
        </ion-label>
      </ion-segment-button>
    </ion-segment>

    <p v-if="excludedAssets > 0" class="note">
      {{ $t('dashboard.historyExcluded', { n: excludedAssets }) }}
    </p>
    <p v-if="!loading && !error && points.length >= 2" class="note">
      {{ $t('dashboard.historyNote') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { IonButton, IonIcon, IonLabel, IonSegment, IonSegmentButton, IonSkeletonText } from '@ionic/vue'
import { arrowDown, arrowUp, lockClosedOutline } from 'ionicons/icons'
import { computed, nextTick, ref, watch } from 'vue'
import type { HistoryRange, PortfolioHistoryDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from '../stores/portfolios.store'
import { useAuthStore } from '../stores/auth.store'
import { openPaywall } from '../services/paywall'
import { formatCurrency } from '../services/format'
import { intlLocale, t } from '../i18n'
import { balancesHidden, BALANCE_MASK } from '../services/privacy'

const auth = useAuthStore()

const props = defineProps<{ currency: 'EUR' | 'USD'; hasHoldings: boolean }>()

const range = ref<HistoryRange>('24h')
const points = ref<PortfolioHistoryDto['points']>([])
const excludedAssets = ref(0)
const loading = ref(false)
const error = ref(false)

// Visible whenever the user has holdings: render loading / error / chart / empty
// inside. Never silently vanish — an all-excluded portfolio still gets a message.
const visible = computed(() => props.hasHoldings)

async function load() {
  loading.value = true
  error.value = false
  try {
    const res = await api.get<PortfolioHistoryDto>(
      `/portfolio/history?range=${range.value}&currency=${props.currency}${usePortfoliosStore().scopeQuery('&')}`,
    )
    points.value = res.points
    excludedAssets.value = res.excludedAssets
  } catch {
    points.value = []
    excludedAssets.value = 0
    error.value = true
  } finally {
    loading.value = false
  }
}

function onRangeChange(ev: CustomEvent) {
  const value = ev.detail.value as HistoryRange
  // 1-year history is Pro — free users get the paywall instead of the range
  if (value === '1y' && !auth.isPro) {
    openPaywall('history1y')
    // Ionic leaves the tapped (locked) button checked even though `range` never
    // changes. Reset the segment back to the active range so the switcher does
    // not lie about which range the chart is showing.
    const el = ev.target as (EventTarget & { value: string }) | null
    nextTick(() => {
      if (el) el.value = range.value
    })
    return
  }
  range.value = value
  load()
}

watch(
  () => [props.currency, props.hasHoldings] as const,
  ([, has]) => {
    if (has) load()
  },
  { immediate: true },
)

defineExpose({ reload: load })

const firstValue = computed(() => points.value[0]?.value ?? null)
const lastValue = computed(() => points.value.at(-1)?.value ?? null)

const deltaPercent = computed(() => {
  const first = Number(firstValue.value)
  const last = Number(lastValue.value)
  if (!first || !Number.isFinite(first) || !Number.isFinite(last)) return null
  return ((last - first) / first) * 100
})

// Treat sub-0.05 % moves as flat: a genuinely unchanged range must not render as
// a green "+0.0 %" gain (or a red loss). Threshold matches the 1-decimal display.
const deltaClass = computed(() => {
  if (deltaPercent.value === null) return ''
  if (deltaPercent.value >= 0.05) return 'gain'
  if (deltaPercent.value <= -0.05) return 'loss'
  return 'flat'
})

const deltaWord = computed(() =>
  deltaClass.value === 'gain' ? t('ui.change.up') : deltaClass.value === 'loss' ? t('ui.change.down') : t('ui.change.flat'),
)

// Absolute change over the range, signed like the percentage
const deltaAmount = computed(() => {
  if (balancesHidden.value) return BALANCE_MASK
  const diff = Number(lastValue.value) - Number(firstValue.value)
  const abs = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: props.currency }).format(Math.abs(diff))
  if (deltaClass.value === 'gain') return `+${abs}`
  if (deltaClass.value === 'loss') return `−${abs}`
  return abs
})

const chartLabel = computed(() =>
  `${t('dashboard.history')}: ${formatCurrency(firstValue.value, props.currency)} → ${formatCurrency(lastValue.value, props.currency)}`,
)

function formatDelta(value: number): string {
  const formatted = new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(value))
  if (value >= 0.05) return `+${formatted} %`
  if (value <= -0.05) return `−${formatted} %`
  return `${formatted} %`
}

// Scale to viewBox 300×90 with a 4 % value buffer top/bottom
const scaled = computed(() => {
  const values = points.value.map((p) => Number(p.value))
  if (values.length < 2) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min || max || 1) * 0.04
  const low = min - pad
  const high = max + pad
  return values.map((v, i) => ({
    x: (i / (values.length - 1)) * 300,
    y: 90 - ((v - low) / (high - low)) * 90,
  }))
})

const linePath = computed(() =>
  scaled.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
)

const areaPath = computed(() =>
  scaled.value.length < 2 ? '' : `${linePath.value} L300,90 L0,90 Z`,
)
</script>

<style scoped>
.chart-block {
  margin-top: var(--app-space-2);
}
.change {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  margin: 0 0 var(--app-space-3);
  font-size: var(--app-text-sm);
  font-weight: 600;
}
.change ion-icon {
  font-size: 1rem;
}
.change.gain {
  color: var(--app-gain);
}
.change.loss {
  color: var(--app-loss);
}
.change.flat {
  color: var(--app-ink-2);
}
.change .since {
  color: var(--app-ink-2);
  font-weight: 500;
}
.plot {
  min-height: 112px;
}
.chart {
  width: 100%;
  height: 96px;
  display: block;
  overflow: visible;
}
.line {
  stroke: var(--app-ink);
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.area {
  fill: var(--app-ink);
  opacity: 0.05;
}
.axis {
  display: flex;
  justify-content: space-between;
  margin-top: var(--app-space-1);
  font-size: var(--app-text-xs);
  color: var(--app-ink-2);
}
.chart-state {
  min-height: 112px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: var(--app-space-2);
}
.plot-skeleton {
  width: 100%;
  height: 96px;
}
.ranges {
  margin-top: var(--app-space-3);
}
.lock {
  font-size: 0.8em;
  vertical-align: -1px;
  margin-left: 2px;
}
.note {
  margin: var(--app-space-2) 0 0;
  font-size: var(--app-text-xs);
  color: var(--app-ink-2);
}
</style>
