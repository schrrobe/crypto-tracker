<template>
  <ion-card v-if="visible" data-testid="portfolio-chart">
    <ion-card-header class="header">
      <ion-card-subtitle>{{ $t('dashboard.history') }}</ion-card-subtitle>
      <span
        v-if="deltaPercent !== null"
        class="delta amount"
        :class="deltaClass"
        data-testid="chart-delta"
      >
        {{ formatDelta(deltaPercent) }}
      </span>
    </ion-card-header>
    <ion-card-content>
      <div v-if="loading" class="chart-loading"><ion-spinner name="crescent" /></div>
      <div v-else-if="error" class="chart-error" data-testid="chart-error">
        <p class="muted">{{ $t('dashboard.historyError') }}</p>
        <ion-button size="small" fill="outline" @click="load">{{ $t('common.retry') }}</ion-button>
      </div>
      <template v-else-if="points.length >= 2">
        <svg viewBox="0 0 300 90" class="chart" preserveAspectRatio="none">
          <path :d="areaPath" class="area" />
          <path :d="linePath" class="line" fill="none" />
        </svg>
        <div class="axis amount">
          <span>{{ formatCurrency(firstValue, currency) }}</span>
          <span>{{ formatCurrency(lastValue, currency) }}</span>
        </div>
      </template>
      <div v-else class="chart-empty" data-testid="chart-empty">
        <p class="muted">{{ $t('dashboard.historyEmpty') }}</p>
      </div>

      <ion-segment :value="range" class="ranges" @ionChange="onRangeChange($event.detail.value as HistoryRange)">
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
            <ion-icon v-if="!auth.isPro" :icon="lockClosed" class="lock" aria-hidden="true" />
          </ion-label>
        </ion-segment-button>
      </ion-segment>

      <p v-if="excludedAssets > 0" class="muted">
        {{ $t('dashboard.historyExcluded', { n: excludedAssets }) }}
      </p>
      <p v-if="!loading && !error && points.length >= 2" class="muted">
        {{ $t('dashboard.historyNote') }}
      </p>
    </ion-card-content>
  </ion-card>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonIcon,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
} from '@ionic/vue'
import { lockClosed } from 'ionicons/icons'
import { computed, ref, watch } from 'vue'
import type { HistoryRange, PortfolioHistoryDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from '../stores/portfolios.store'
import { useAuthStore } from '../stores/auth.store'
import { openPaywall } from '../services/paywall'
import { formatCurrency } from '../services/format'
import { intlLocale } from '../i18n'

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

function onRangeChange(value: HistoryRange) {
  // 1-year history is Pro — free users get the paywall instead of the range
  if (value === '1y' && !auth.isPro) {
    openPaywall()
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
.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: baseline;
}
.delta.gain {
  color: var(--app-color-gain);
}
.delta.loss {
  color: var(--app-color-loss);
}
.delta.flat {
  color: var(--ion-color-medium);
}
.lock {
  font-size: 0.85em;
  vertical-align: middle;
  margin-left: 3px;
}
.chart {
  width: 100%;
  height: 90px;
  display: block;
}
.chart-loading {
  height: 90px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chart-error,
.chart-empty {
  min-height: 90px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}
.line {
  stroke: var(--ion-color-primary);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.area {
  fill: var(--ion-color-primary);
  opacity: 0.12;
}
.axis {
  display: flex;
  justify-content: space-between;
  font-size: 0.75em;
  color: var(--ion-color-medium);
  margin-top: 2px;
}
.ranges {
  margin-top: 10px;
}
.muted {
  color: var(--ion-color-medium);
  font-size: 0.8em;
  margin-top: 8px;
}
</style>
