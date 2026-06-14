<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <PortfolioSwitcher @switched="loadData" />
        </ion-buttons>
        <ion-title>{{ $t('tabs.dashboard') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button
            data-testid="toggle-balances"
            :title="$t('common.toggleBalances')"
            @click="toggleBalances"
          >
            <ion-icon :icon="balancesHidden ? eyeOffOutline : eyeOutline" />
          </ion-button>
          <ion-button data-testid="refresh-button" :disabled="portfolio.loading" @click="refresh">
            <ion-spinner v-if="portfolio.loading" name="crescent" />
            <ion-icon v-else :icon="refreshOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-refresher slot="fixed" @ionRefresh="onPullRefresh">
        <ion-refresher-content />
      </ion-refresher>

      <LoadingSkeleton v-if="pageLoading && !portfolio.summary" />
      <ErrorState v-else-if="pageError && !portfolio.summary" @retry="loadData" />
      <template v-else>
      <ion-card button data-testid="total-value-card" @click="toggleCurrency">
        <ion-card-header>
          <ion-card-subtitle>{{ $t('dashboard.totalValue', { currency }) }}</ion-card-subtitle>
          <ion-card-title class="amount total" :class="{ negative: totalIsNegative }" data-testid="total-value">
            {{ totalFormatted }}
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p v-if="totalIsNegative" class="muted" data-testid="net-liability-note">
            {{ $t('dashboard.netLiabilityNote') }}
          </p>
          <p class="muted">
            {{
              $t('dashboard.pricesUpdated', {
                time: formatRelativeTime(portfolio.summary?.pricesFetchedAt ?? null),
                currency: currency === 'EUR' ? 'USD' : 'EUR',
              })
            }}
          </p>
        </ion-card-content>
      </ion-card>

      <PortfolioChart :currency="currency" :has-holdings="topAssets.length > 0" />

      <AllocationDonut :positions="portfolio.summary?.byAsset ?? []" />

      <!-- Gewinn/Verlust (Pro) — Free: Schloss → Paywall -->
      <ion-card
        v-if="topAssets.length > 0"
        data-testid="pnl-card"
        :button="!auth.isPro"
        @click="!auth.isPro && openPaywall()"
      >
        <ion-card-header>
          <ion-card-subtitle>
            {{ $t('pnl.title') }}
            <ion-icon v-if="!auth.isPro" :icon="lockClosedOutline" />
          </ion-card-subtitle>
          <ion-card-title
            v-if="auth.isPro && portfolio.pnl && portfolio.pnl.positions.length > 0"
            class="amount"
            :style="{ color: pnlColor(portfolio.pnl.totalPnlEur) }"
            data-testid="pnl-total"
          >
            {{ formatCurrencyRaw(portfolio.pnl.totalPnlEur, 'EUR') }}
            ({{ portfolio.pnl.totalPnlPct > 0 ? '+' : '' }}{{ portfolio.pnl.totalPnlPct }} %)
          </ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p v-if="!auth.isPro" class="muted">{{ $t('pnl.locked') }}</p>
          <template v-else-if="portfolio.pnl && portfolio.pnl.positions.length > 0">
            <div v-for="p in portfolio.pnl.positions" :key="p.sourceId + p.assetSymbol" class="pnl-row">
              <span>{{ p.assetSymbol }}</span>
              <span class="amount" :style="{ color: pnlColor(p.pnlEur) }">
                {{ formatCurrencyRaw(p.pnlEur, 'EUR') }}
              </span>
            </div>
          </template>
          <p v-else class="muted">{{ $t('pnl.empty') }}</p>
          <p class="muted">{{ $t('pnl.basisNote') }}</p>
        </ion-card-content>
      </ion-card>

      <!-- Konten-Aufteilung (Earn/Margin/Futures) — frei -->
      <ion-card v-if="hasBreakdown" data-testid="account-breakdown-card">
        <ion-card-header>
          <ion-card-subtitle>{{ $t('dashboard.accountBreakdown') }}</ion-card-subtitle>
        </ion-card-header>
        <ion-card-content>
          <div
            v-for="row in breakdownRows"
            :key="row.accountType"
            class="pnl-row"
            :data-testid="`breakdown-${row.accountType}`"
          >
            <span>{{ $t(`holdings.accountType.${row.accountType}`) }}</span>
            <span class="amount" :class="{ negative: rowIsNegative(row) }">
              {{ formatCurrency(currency === 'EUR' ? row.valueEur : row.valueUsd, currency) }}
            </span>
          </div>
          <div v-if="futuresUpnl !== null" class="pnl-row" data-testid="breakdown-futures-upnl">
            <span>{{ $t('futures.uPnl') }}</span>
            <span class="amount" :style="{ color: pnlColor(futuresUpnl) }">
              {{ formatCurrencyRaw(futuresUpnl, 'EUR') }}
            </span>
          </div>
          <p class="muted">{{ $t('futures.uPnlNote') }}</p>
        </ion-card-content>
      </ion-card>

      <ion-list v-if="topAssets.length > 0" inset>
        <ion-list-header>
          <ion-label>{{ $t('dashboard.topPositions') }}</ion-label>
        </ion-list-header>
        <ion-item v-for="position in topAssets" :key="position.asset.id">
          <ion-label>
            <h3>{{ position.asset.symbol }}</h3>
            <p>{{ formatQuantity(position.quantity) }} {{ position.asset.symbol }}</p>
          </ion-label>
          <ion-note slot="end" class="amount">
            {{ formatCurrency(currency === 'EUR' ? position.valueEur : position.valueUsd, currency) }}
          </ion-note>
        </ion-item>
      </ion-list>

      <div v-else class="empty" data-testid="dashboard-empty">
        <p>{{ $t('dashboard.empty') }}</p>
        <div class="onboarding">
          <ion-button fill="outline" data-testid="onboarding-connect" router-link="/tabs/sources?add=1">
            {{ $t('sources.connectSource') }}
          </ion-button>
          <ion-button fill="outline" data-testid="onboarding-csv" router-link="/tabs/sources?csv=1">
            {{ $t('onboarding.importCsv') }}
          </ion-button>
          <ion-button fill="outline" data-testid="onboarding-manual" router-link="/tabs/holdings?add=1">
            {{ $t('onboarding.addManual') }}
          </ion-button>
        </div>
      </div>

      <ion-text v-if="(portfolio.summary?.unmappedAssets.length ?? 0) > 0" color="warning">
        <p class="ion-padding-horizontal">
          {{ $t('dashboard.unmapped', { n: portfolio.summary?.unmappedAssets.length }) }}
        </p>
      </ion-text>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue'
import { eyeOffOutline, eyeOutline, lockClosedOutline, refreshOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import AllocationDonut from '../components/AllocationDonut.vue'
import PortfolioChart from '../components/PortfolioChart.vue'
import PortfolioSwitcher from '../components/PortfolioSwitcher.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useAuthStore } from '../stores/auth.store'
import { formatCurrency, formatCurrencyRaw, formatQuantity, formatRelativeTime } from '../services/format'
import { balancesHidden, toggleBalances } from '../services/privacy'
import { openPaywall } from '../services/paywall'

const portfolio = usePortfolioStore()
const auth = useAuthStore()

function pnlColor(value: string): string {
  return Number(value) < 0 ? 'var(--app-color-loss)' : 'var(--app-color-gain)'
}

const currency = ref<'EUR' | 'USD'>((auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR')
const pageLoading = ref(false)
const pageError = ref(false)

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await portfolio.loadSummary()
    // PnL nur für Pro laden (Free sieht die Paywall am Schloss)
    if (auth.isPro) await portfolio.loadPnl().catch(() => {})
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

const totalFormatted = computed(() => {
  const s = portfolio.summary
  if (!s) return '…'
  return formatCurrency(currency.value === 'EUR' ? s.totalEur : s.totalUsd, currency.value)
})

const topAssets = computed(() => (portfolio.summary?.byAsset ?? []).slice(0, 5))

// Konten-Aufteilung: SPOT ist bereits das Headline-Total → nur Nicht-SPOT zeigen
const breakdownRows = computed(() =>
  (portfolio.summary?.byAccountType ?? []).filter((r) => r.accountType !== 'SPOT'),
)
const futuresUpnl = computed(() => portfolio.summary?.futuresUnrealizedPnlEur ?? null)
const hasBreakdown = computed(() => breakdownRows.value.length > 0 || futuresUpnl.value !== null)
function rowIsNegative(row: { valueEur: string; valueUsd: string }): boolean {
  return Number(currency.value === 'EUR' ? row.valueEur : row.valueUsd) < 0
}
const totalIsNegative = computed(() => {
  const s = portfolio.summary
  if (!s) return false
  return Number(currency.value === 'EUR' ? s.totalEur : s.totalUsd) < 0
})

function toggleCurrency() {
  currency.value = currency.value === 'EUR' ? 'USD' : 'EUR'
}

async function refresh() {
  await portfolio.refresh()
}

async function onPullRefresh(event: RefresherCustomEvent) {
  await portfolio.refresh()
  await event.target.complete()
}

onIonViewWillEnter(() => {
  // Basiswährung kann sich in den Einstellungen geändert haben
  currency.value = (auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR'
  loadData()
})
</script>

<style scoped>
.total {
  font-size: 2.2rem;
}
.amount.negative {
  color: var(--app-color-loss, #dc2626);
}
.pnl-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}
.muted {
  color: var(--ion-color-medium);
  font-size: 0.85em;
}
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
.onboarding {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 280px;
  margin: 16px auto 0;
}
</style>
