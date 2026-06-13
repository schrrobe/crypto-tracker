<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('market.title') }}</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment :value="view" @ionChange="view = $event.detail.value as ViewKind">
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
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-refresher slot="fixed" @ionRefresh="onRefresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <LoadingSkeleton v-if="pageLoading && coins.length === 0" />
      <ErrorState v-else-if="pageError && coins.length === 0" @retry="loadData" />

      <ion-list v-else inset>
        <ion-item v-for="coin in displayed" :key="coin.id" :data-testid="`market-${coin.symbol}`">
          <ion-avatar v-if="coin.iconUrl" slot="start" class="coin-icon">
            <img :src="coin.iconUrl" :alt="coin.symbol" loading="lazy" />
          </ion-avatar>
          <ion-label>
            <h3>
              <span class="rank">#{{ coin.rank }}</span>
              {{ coin.symbol }} · {{ coin.name }}
            </h3>
            <p>{{ $t('market.marketCap') }}: {{ compact(coin.marketCap) }}</p>
          </ion-label>
          <div slot="end" class="price-block">
            <strong>{{ formatCurrency(String(coin.price), currency) }}</strong>
            <span
              v-if="coin.change24hPct !== null"
              :class="coin.change24hPct >= 0 ? 'up' : 'down'"
              class="change"
            >
              {{ coin.change24hPct >= 0 ? '+' : '' }}{{ coin.change24hPct.toFixed(2) }}%
            </span>
          </div>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonAvatar,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import { computed, ref } from 'vue'
import type { MarketCoinDto, MarketDto } from '@crypto-tracker/shared'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { api } from '../services/api.client'
import { formatCurrency, intlLocale } from '../services/format'
import { useAuthStore } from '../stores/auth.store'

type ViewKind = 'top' | 'gainers' | 'losers'

const auth = useAuthStore()
const coins = ref<MarketCoinDto[]>([])
const view = ref<ViewKind>('top')
const pageLoading = ref(false)
const pageError = ref(false)

const currency = computed(() => (auth.user?.baseCurrency === 'USD' ? 'USD' : 'EUR') as 'EUR' | 'USD')

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
  loadData()
})
</script>

<style scoped>
.coin-icon {
  width: 28px;
  height: 28px;
}
.rank {
  color: var(--ion-color-medium);
  font-size: 0.85em;
  margin-right: 4px;
}
.price-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: 0.95em;
}
.change.up {
  color: var(--ion-color-success);
}
.change.down {
  color: var(--ion-color-danger);
}
</style>
