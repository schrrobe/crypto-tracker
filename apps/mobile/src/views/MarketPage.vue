<template>
  <ion-page>
    <AppTopBar :title="$t('market.title')" :show-switcher="false" :show-privacy="false">
      <template #below>
        <ion-toolbar class="segment-bar">
          <ion-segment :value="view" :aria-label="$t('market.title')" @ionChange="view = $event.detail.value as ViewKind">
            <ion-segment-button value="top" data-testid="market-top">
              <ion-label>{{ $t('market.top') }}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="gainers" data-testid="market-gainers">
              <ion-label>{{ $t('market.gainers') }}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="losers" data-testid="market-losers">
              <ion-label>{{ $t('market.losers') }}</ion-label>
            </ion-segment-button>
          </ion-segment>
        </ion-toolbar>
      </template>
    </AppTopBar>
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="onRefresh($event)">
        <ion-refresher-content />
      </ion-refresher>
      <div class="page">
        <LoadingSkeleton v-if="pageLoading && coins.length === 0" :count="8" />
        <ErrorState v-else-if="pageError && coins.length === 0" @retry="loadData" />
        <template v-else>
          <p class="hint top-hint">{{ $t('ui.market.note', { currency }) }}</p>
          <ol class="stmt sheet">
            <li v-for="coin in displayed" :key="coin.id" :data-testid="`market-${coin.symbol}`">
              <div class="stmt-row coin-row">
                <span class="rank fig">#{{ coin.rank }}</span>
                <AssetIcon :src="coin.iconUrl" :symbol="coin.symbol" :size="28" />
                <span class="stmt-main">
                  <span class="stmt-label">
                    {{ coin.symbol }}
                    <span v-if="held.has(coin.symbol)" class="tag held">{{ $t('ui.market.held') }}</span>
                  </span>
                  <span class="stmt-sub">{{ coin.name }} · <span class="fig">{{ compact(coin.marketCap) }}</span></span>
                </span>
                <span class="stmt-value">
                  <span class="fig price">{{ formatCurrencyRaw(String(coin.price), currency) }}</span>
                  <span
                    v-if="coin.change24hPct !== null"
                    class="fig change"
                    :class="coin.change24hPct > 0 ? 'gain' : coin.change24hPct < 0 ? 'loss' : ''"
                  >
                    <ion-icon
                      v-if="coin.change24hPct !== 0"
                      :icon="coin.change24hPct > 0 ? arrowUp : arrowDown"
                      aria-hidden="true"
                    />
                    <span class="sr-only">{{ coin.change24hPct >= 0 ? $t('ui.change.up') : $t('ui.change.down') }}</span>
                    {{ formatPct(coin.change24hPct) }}
                  </span>
                </span>
              </div>
            </li>
          </ol>
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { arrowDown, arrowUp } from 'ionicons/icons'
import {
  IonContent,
  IonIcon,
  IonLabel,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import { computed, ref } from 'vue'
import type { MarketCoinDto, MarketDto } from '@crypto-tracker/shared'
import AppTopBar from '../components/AppTopBar.vue'
import AssetIcon from '../components/AssetIcon.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { api } from '../services/api.client'
import { formatCurrencyRaw, intlLocale } from '../services/format'
import { useAuthStore } from '../stores/auth.store'
import { usePortfolioStore } from '../stores/portfolio.store'

type ViewKind = 'top' | 'gainers' | 'losers'

const auth = useAuthStore()
const portfolio = usePortfolioStore()
const coins = ref<MarketCoinDto[]>([])
const view = ref<ViewKind>('top')
const pageLoading = ref(false)
const pageError = ref(false)

const currency = computed(() => (auth.user?.baseCurrency === 'USD' ? 'USD' : 'EUR') as 'EUR' | 'USD')

// Market data is context, not a trading floor: mark what the user already holds
const held = computed(() => new Set(portfolio.holdings.map((h) => h.asset.symbol.toUpperCase())))

const displayed = computed(() => {
  if (view.value === 'top') return coins.value
  const withChange = coins.value.filter((c) => c.change24hPct !== null)
  const sorted = [...withChange].sort((a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0))
  return view.value === 'gainers' ? sorted.slice(0, 20) : sorted.reverse().slice(0, 20)
})

function compact(value: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    style: 'currency',
    currency: currency.value,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPct(value: number): string {
  const abs = new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(value),
  )
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${abs} %`
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    const res = await api.get<MarketDto>(`/market?currency=${currency.value}`)
    coins.value = res.coins
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

async function onRefresh(event: CustomEvent) {
  await loadData()
  ;(event.target as unknown as { complete: () => void } | null)?.complete()
}

onIonViewWillEnter(() => {
  void loadData()
  if (portfolio.holdings.length === 0) portfolio.loadHoldings().catch(() => {})
})
</script>

<style scoped>
.segment-bar {
  --padding-start: var(--app-space-4);
  --padding-end: var(--app-space-4);
  --padding-bottom: var(--app-space-2);
}
.top-hint {
  margin: 0 0 var(--app-space-3);
}
.coin-row {
  grid-template-columns: 2.25rem 28px minmax(0, 1fr) auto;
}
.rank {
  font-size: var(--app-text-xs);
  color: var(--app-ink-3);
  text-align: right;
}
.held {
  margin-left: 4px;
}
.stmt-value {
  display: grid;
  justify-items: end;
}
.price {
  font-size: var(--app-text-md);
}
.change {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: var(--app-text-xs);
  font-weight: 600;
}
</style>
