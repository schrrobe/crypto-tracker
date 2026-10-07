<template>
  <ion-page>
    <AppTopBar :title="$t('tabs.dashboard')" @switched="loadData">
      <template #end>
        <ion-button
          data-testid="refresh-button"
          :disabled="portfolio.loading"
          :aria-label="$t('ui.overview.refresh')"
          :title="$t('ui.overview.refresh')"
          @click="refresh"
        >
          <ion-spinner v-if="portfolio.loading" name="crescent" aria-hidden="true" />
          <ion-icon v-else slot="icon-only" :icon="refreshOutline" aria-hidden="true" />
        </ion-button>
      </template>
    </AppTopBar>

    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="onPullRefresh">
        <ion-refresher-content />
      </ion-refresher>

      <div class="page">
        <!-- Pending surveys: quiet notice, one per survey -->
        <router-link
          v-for="s in surveys.pending"
          :key="s.id"
          class="notice notice--info survey"
          data-testid="survey-banner"
          :to="`/tabs/dashboard/surveys/${s.id}`"
        >
          <ion-icon :icon="chatbubbleEllipsesOutline" aria-hidden="true" />
          <span>
            <strong>{{ s.title }}</strong>
            <span class="survey-cta">{{ $t('surveys.bannerTitle') }} · {{ $t('surveys.fillOut') }}</span>
          </span>
        </router-link>

        <LoadingSkeleton v-if="pageLoading && !portfolio.summary" />
        <ErrorState v-else-if="pageError && !portfolio.summary" @retry="loadData" />
        <template v-else>
          <!-- Saldo: the statement's bottom line, first -->
          <button
            type="button"
            class="saldo"
            data-testid="total-value-card"
            :aria-label="`${$t('ui.overview.saldo')} ${totalFormatted}. ${$t('ui.overview.currencyToggle', { currency: otherCurrency })}`"
            @click="toggleCurrency"
          >
            <span class="saldo-label">
              {{ $t('ui.overview.saldo') }}
              <span class="tag">{{ currency }}</span>
            </span>
            <span class="saldo-value fig" :class="{ negative: totalIsNegative }" data-testid="total-value">
              {{ totalFormatted }}
            </span>
            <span
              v-if="portfolio.summary?.pricesFetchedAt"
              class="saldo-asof"
              :title="formatRelativeTime(portfolio.summary.pricesFetchedAt)"
            >
              {{ $t('ui.overview.asOf', { time: '' }) }}<span class="fig">{{ stamp(portfolio.summary.pricesFetchedAt) }}</span>
            </span>
          </button>
          <p v-if="totalIsNegative" class="muted" data-testid="net-liability-note">
            {{ $t('dashboard.netLiabilityNote') }}
          </p>

          <PortfolioChart :currency="currency" :has-holdings="hasHoldings" />

          <template v-if="hasHoldings">
            <!-- Positionen: one line per source, Summenstrich, Saldo -->
            <section class="section" aria-labelledby="positions-title">
              <div class="section-head">
                <h2 id="positions-title" class="section-title">{{ $t('ui.overview.positions') }}</h2>
              </div>
              <div class="sheet">
                <ul class="stmt">
                  <li v-for="p in positions" :key="p.sourceId">
                    <button
                      type="button"
                      class="stmt-row"
                      :class="{
                        'is-focused': focusSource === p.sourceId,
                        'is-dimmed': focusSource !== null && focusSource !== p.sourceId,
                      }"
                      :aria-pressed="focusSource === p.sourceId ? 'true' : 'false'"
                      :data-testid="`position-${p.label}`"
                      @click="toggleFocus(p.sourceId)"
                    >
                      <span class="stmt-main">
                        <span class="stmt-label">{{ p.label }}</span>
                        <span class="stmt-sub">
                          <SyncStatusBadge
                            v-if="p.source"
                            :source="p.source"
                            :syncing="sourcesStore.syncing.has(p.sourceId)"
                            :interactive="false"
                          />
                        </span>
                      </span>
                      <span class="stmt-value fig" :class="{ negative: Number(p.value) < 0 }">
                        {{ formatCurrency(p.value, currency) }}
                      </span>
                    </button>
                  </li>
                </ul>
                <div class="stmt-total">
                  <span>{{ $t('ui.overview.saldo') }}</span>
                  <span class="fig" :class="{ negative: totalIsNegative }">{{ totalFormatted }}</span>
                </div>
              </div>
              <p class="hint">{{ $t('ui.overview.positionsHint') }}</p>

              <!-- Account types beyond spot + futures uPnL (not part of the Saldo) -->
              <div v-if="hasBreakdown" class="sheet breakdown" data-testid="account-breakdown-card">
                <h3 class="sheet-title">{{ $t('dashboard.accountBreakdown') }}</h3>
                <ul class="stmt">
                  <li v-for="row in breakdownRows" :key="row.accountType">
                    <div class="stmt-row" :data-testid="`breakdown-${row.accountType}`">
                      <span class="stmt-label">{{ $t(`holdings.accountType.${row.accountType}`) }}</span>
                      <span class="stmt-value fig" :class="{ negative: rowIsNegative(row) }">
                        {{ formatCurrency(currency === 'EUR' ? row.valueEur : row.valueUsd, currency) }}
                      </span>
                    </div>
                  </li>
                  <li v-if="futuresUpnl !== null">
                    <div class="stmt-row" data-testid="breakdown-futures-upnl">
                      <span class="stmt-main">
                        <span class="stmt-label">{{ $t('futures.uPnl') }}</span>
                        <span class="stmt-sub">{{ $t('futures.uPnlNote') }}</span>
                      </span>
                      <span class="stmt-value fig" :class="toneOf(futuresUpnl)">{{ signedEur(futuresUpnl) }}</span>
                    </div>
                  </li>
                </ul>
              </div>

            </section>

            <!-- Bewegungen: what was booked, newest first -->
            <section class="section" aria-labelledby="movements-title">
              <div class="section-head">
                <h2 id="movements-title" class="section-title">
                  {{ focusLabel ? $t('ui.overview.movementsOf', { source: focusLabel }) : $t('ui.overview.movements') }}
                </h2>
                <button v-if="focusSource" type="button" class="section-link" @click="toggleFocus(focusSource)">
                  {{ $t('ui.overview.showAllSources') }}
                </button>
                <router-link v-else class="section-link" to="/tabs/dashboard/movements" data-testid="open-movements">
                  {{ $t('ui.overview.allMovements') }}
                </router-link>
              </div>
              <div class="sheet" aria-live="polite">
                <div v-if="movements.loading && movements.groups.length === 0" class="pad">
                  <ion-skeleton-text v-for="i in 3" :key="i" animated class="line-skeleton" />
                </div>
                <div v-else-if="movements.error" class="pad" role="status">
                  <p class="muted">{{ $t('ui.overview.movementsError') }}</p>
                  <ion-button size="small" fill="outline" @click="loadMovements">{{ $t('common.retry') }}</ion-button>
                </div>
                <p v-else-if="visibleMovements.length === 0" class="pad muted" data-testid="movements-empty">
                  {{ $t('ui.overview.noMovements') }}
                </p>
                <MovementList
                  v-else
                  :groups="visibleMovements"
                  :currency="currency"
                  :label="$t('ui.overview.movements')"
                  :show-source="!focusSource"
                  :is-fresh="movements.isFresh"
                />
              </div>
              <p class="hint">
                {{ $t('ui.movement.window', { days: movements.historyDays }) }}
                <button v-if="movements.historyDays < 365" type="button" class="inline-link" @click="openPaywall('history1y')">
                  {{ $t('ui.movement.windowPro') }}
                </button>
              </p>
            </section>

          <!-- Unrealised P/L after the movements. Free: one locked line at the point of use -->
            <component
              :is="auth.isPro ? 'div' : 'button'"
              :type="auth.isPro ? undefined : 'button'"
              class="sheet pnl"
              :class="{ 'pnl--locked': !auth.isPro }"
              data-testid="pnl-card"
              :aria-label="auth.isPro ? undefined : `${$t('pnl.title')}: ${$t('pnl.locked')}`"
              @click="!auth.isPro && openPaywall('pnl')"
            >
              <div class="pnl-head">
                <h3 class="sheet-title">{{ $t('pnl.title') }}</h3>
                <span v-if="!auth.isPro" class="tag">
                  <ion-icon :icon="lockClosedOutline" aria-hidden="true" /> Pro
                </span>
                <span
                  v-else-if="portfolio.pnl && portfolio.pnl.positions.length > 0"
                  class="fig pnl-total"
                  :class="toneOf(portfolio.pnl.totalPnlEur)"
                  data-testid="pnl-total"
                >
                  {{ signedEur(portfolio.pnl.totalPnlEur) }}
                  ({{ portfolio.pnl.totalPnlPct > 0 ? '+' : '' }}{{ portfolio.pnl.totalPnlPct }} %)
                </span>
              </div>
              <template v-if="auth.isPro && portfolio.pnl && portfolio.pnl.positions.length > 0">
                <ul class="stmt pnl-rows">
                  <li v-for="p in portfolio.pnl.positions" :key="p.sourceId + p.assetSymbol" class="pnl-row">
                    <span>{{ p.assetSymbol }} <span class="muted">· {{ p.sourceLabel }}</span></span>
                    <span class="fig" :class="toneOf(p.pnlEur)">{{ signedEur(p.pnlEur) }}</span>
                  </li>
                </ul>
                <p v-if="portfolio.pnl.excludedCount > 0" class="muted" data-testid="pnl-coverage">
                  {{
                    $t('pnl.coverage', {
                      covered: portfolio.pnl.coveredCount,
                      total: portfolio.pnl.coveredCount + portfolio.pnl.excludedCount,
                      value: formatCurrencyRaw(portfolio.pnl.excludedValueEur, 'EUR'),
                    })
                  }}
                </p>
                <p class="muted">{{ $t('pnl.basisNote') }}</p>
              </template>
              <div v-else-if="pnlError" data-testid="pnl-error">
                <p class="muted">{{ $t('pnl.error') }}</p>
                <ion-button size="small" fill="outline" @click="reloadPnl">{{ $t('common.retry') }}</ion-button>
              </div>
              <p v-else-if="auth.isPro" class="muted">{{ $t('pnl.empty') }}</p>
            </component>
          </template>

          <!-- Empty: teach the four ways in -->
          <section v-else class="section empty-state" data-testid="dashboard-empty">
            <h2>{{ $t('ui.empty.title') }}</h2>
            <p>{{ $t('ui.empty.body') }}</p>
            <AddOptions />
          </section>

          <p v-if="(portfolio.summary?.unmappedAssets.length ?? 0) > 0" class="notice section-notice" role="note">
            <ion-icon :icon="alertCircleOutline" aria-hidden="true" />
            <span>{{ $t('dashboard.unmapped', { n: portfolio.summary?.unmappedAssets.length }) }}</span>
          </p>
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonIcon,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSkeletonText,
  IonSpinner,
  onIonViewDidEnter,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue'
import {
  alertCircleOutline,
  chatbubbleEllipsesOutline,
  lockClosedOutline,
  refreshOutline,
} from 'ionicons/icons'
import { computed, ref } from 'vue'
import type { SourceDto } from '@crypto-tracker/shared'
import AppTopBar from '../components/AppTopBar.vue'
import AddOptions from '../components/AddOptions.vue'
import MovementList from '../components/MovementList.vue'
import PortfolioChart from '../components/PortfolioChart.vue'
import SyncStatusBadge from '../components/SyncStatusBadge.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'
import { useMovementsStore } from '../stores/movements.store'
import { useAuthStore } from '../stores/auth.store'
import { useSurveysStore } from '../stores/surveys.store'
import { formatCurrency, formatCurrencyRaw, formatRelativeTime, intlLocale } from '../services/format'
import { balancesHidden, BALANCE_MASK } from '../services/privacy'
import { openPaywall } from '../services/paywall'

const portfolio = usePortfolioStore()
const sourcesStore = useSourcesStore()
const movements = useMovementsStore()
const auth = useAuthStore()
const surveys = useSurveysStore()

const OVERVIEW_LINES = 12

const currency = ref<'EUR' | 'USD'>((auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR')
const otherCurrency = computed(() => (currency.value === 'EUR' ? 'USD' : 'EUR'))
const pageLoading = ref(false)
const pageError = ref(false)
const pnlError = ref(false)
const focusSource = ref<string | null>(null)

async function loadMovements() {
  await movements.load({}, 40)
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  focusSource.value = null
  try {
    await Promise.all([portfolio.loadSummary(), portfolio.loadHoldings(), sourcesStore.load()])
    // Pro only: Free sees the lock and the paywall
    if (auth.isPro) await reloadPnl()
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
  void loadMovements()
}

async function reloadPnl() {
  try {
    await portfolio.loadPnl()
    pnlError.value = false
  } catch {
    pnlError.value = true
  }
}

const hasHoldings = computed(() => (portfolio.summary?.byAsset.length ?? 0) > 0)

const totalFormatted = computed(() => {
  const s = portfolio.summary
  if (!s) return '…'
  return formatCurrency(currency.value === 'EUR' ? s.totalEur : s.totalUsd, currency.value)
})
const totalIsNegative = computed(() => {
  const s = portfolio.summary
  if (!s) return false
  return Number(currency.value === 'EUR' ? s.totalEur : s.totalUsd) < 0
})

// One position per source: Σ of its priced holdings (unpriced lines add nothing)
const positions = computed(() => {
  const bySource = new Map<string, { sourceId: string; label: string; value: number; source?: SourceDto }>()
  for (const h of portfolio.holdings) {
    const v = currency.value === 'EUR' ? h.valueEur : h.valueUsd
    const row = bySource.get(h.sourceId) ?? { sourceId: h.sourceId, label: h.sourceLabel, value: 0 }
    row.value += v === null ? 0 : Number(v)
    bySource.set(h.sourceId, row)
  }
  for (const s of sourcesStore.sources) {
    const row = bySource.get(s.id)
    if (row) row.source = s
  }
  return [...bySource.values()]
    .sort((a, b) => b.value - a.value)
    .map((r) => ({ ...r, value: r.value.toFixed(2) }))
})

const focusLabel = computed(() => positions.value.find((p) => p.sourceId === focusSource.value)?.label ?? null)

function toggleFocus(sourceId: string) {
  focusSource.value = focusSource.value === sourceId ? null : sourceId
}

const visibleMovements = computed(() => {
  const all = focusSource.value
    ? movements.groups.filter((g) => g.sourceId === focusSource.value)
    : movements.groups
  return all.slice(0, OVERVIEW_LINES)
})

const breakdownRows = computed(() =>
  (portfolio.summary?.byAccountType ?? []).filter((r) => r.accountType !== 'SPOT'),
)
const futuresUpnl = computed(() => portfolio.summary?.futuresUnrealizedPnlEur ?? null)
const hasBreakdown = computed(() => breakdownRows.value.length > 0 || futuresUpnl.value !== null)
function rowIsNegative(row: { valueEur: string; valueUsd: string }): boolean {
  return Number(currency.value === 'EUR' ? row.valueEur : row.valueUsd) < 0
}

function toneOf(value: string): string {
  const n = Number(value)
  return n > 0 ? 'gain' : n < 0 ? 'loss' : ''
}

// P/L always carries its sign — colour is never the only signal
function signedEur(value: string): string {
  if (balancesHidden.value) return BALANCE_MASK
  const n = Number(value)
  const abs = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'EUR' }).format(Math.abs(n))
  return n > 0 ? `+${abs}` : n < 0 ? `−${abs}` : abs
}

// Absolute statement stamp ("7. Okt., 14:32"), the relative phrase rides as title
function stamp(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function toggleCurrency() {
  currency.value = otherCurrency.value
}

async function refresh() {
  await portfolio.refresh()
  await Promise.all([sourcesStore.load().catch(() => {}), loadMovements()])
}

async function onPullRefresh(event: RefresherCustomEvent) {
  await refresh()
  await event.target.complete()
}

onIonViewWillEnter(() => {
  // the base currency may have changed in the settings
  currency.value = (auth.user?.baseCurrency as 'EUR' | 'USD') ?? 'EUR'
  void loadData()
  surveys.loadPending().catch(() => {})
})

// The fresh-line highlight plays once; afterwards these lines count as seen
onIonViewDidEnter(() => {
  setTimeout(() => movements.markSeen(), 2500)
})
</script>

<style scoped>
.saldo {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: var(--app-space-2) 0 var(--app-space-1);
  background: none;
  border: 0;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.saldo-label {
  display: flex;
  align-items: center;
  gap: var(--app-space-2);
  font-size: var(--app-text-sm);
  font-weight: 600;
  color: var(--app-ink-2);
}
.saldo-value {
  font-size: var(--app-text-saldo);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.03em;
}
.saldo-asof {
  font-size: var(--app-text-xs);
  color: var(--app-ink-2);
}
.sheet-title {
  margin: 0;
  font-size: var(--app-text-sm);
  font-weight: 650;
}
.breakdown {
  margin-top: var(--app-space-4);
}
.breakdown .sheet-title {
  padding: var(--app-space-3) var(--app-space-4) 0;
}
.pnl {
  display: block;
  width: 100%;
  margin-top: var(--app-space-6);
  padding: var(--app-space-3) var(--app-space-4);
  color: inherit;
  font: inherit;
  text-align: left;
}
button.pnl {
  cursor: pointer;
}
.pnl--locked {
  padding-top: var(--app-space-3);
  padding-bottom: var(--app-space-3);
}
.pnl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--app-space-3);
}
.pnl-total {
  font-weight: 650;
}
.pnl p {
  margin: var(--app-space-2) 0 0;
}
.pnl-rows {
  margin-top: var(--app-space-2);
}
.pnl-row {
  display: flex;
  justify-content: space-between;
  gap: var(--app-space-3);
  padding: 6px 0;
  border-top: 1px solid var(--app-rule);
  font-size: var(--app-text-sm);
}
.pnl .tag ion-icon {
  vertical-align: -1px;
}
.pad {
  padding: var(--app-space-4);
  margin: 0;
}
.line-skeleton {
  height: 18px;
  margin: 10px 0;
}
.survey {
  display: flex;
  gap: var(--app-space-3);
  margin-bottom: var(--app-space-4);
  color: inherit;
  text-decoration: none;
}
.survey ion-icon {
  font-size: 1.25rem;
  color: var(--app-accent);
  flex: none;
}
.survey strong {
  display: block;
}
.survey-cta {
  display: block;
  margin-top: 2px;
  color: var(--app-accent);
  font-weight: 600;
}
.section-notice {
  margin-top: var(--app-space-5);
}
.section-notice ion-icon {
  flex: none;
  font-size: 1.125rem;
  color: var(--app-warn);
}
</style>
