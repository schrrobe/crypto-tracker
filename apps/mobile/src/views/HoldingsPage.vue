<template>
  <ion-page>
    <AppTopBar :title="$t('tabs.holdings')" @switched="loadData">
      <template #end>
        <ion-button
          data-testid="add-holding"
          :aria-label="$t('holdings.addHolding')"
          :title="$t('holdings.addHolding')"
          @click="openAdd"
        >
          <ion-icon slot="icon-only" :icon="addOutline" aria-hidden="true" />
        </ion-button>
      </template>
    </AppTopBar>

    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="onPullRefresh">
        <ion-refresher-content />
      </ion-refresher>
      <div class="page">
        <LoadingSkeleton v-if="pageLoading && portfolio.holdings.length === 0" />
        <ErrorState v-else-if="pageError && portfolio.holdings.length === 0" @retry="loadData" />
        <template v-else-if="portfolio.holdings.length > 0">
          <AllocationBar :positions="portfolio.summary?.byAsset ?? []" />

          <!-- One statement per account type; one line per asset, tap for its sources -->
          <section
            v-for="group in groups"
            :key="group.type"
            class="section"
            :data-testid="`holdings-group-${group.type}`"
            :aria-labelledby="`group-${group.type}`"
          >
            <div class="section-head">
              <h2 :id="`group-${group.type}`" class="section-title">
                <span :data-testid="`holding-badge-${group.type}`">{{ $t(`holdings.accountType.${group.type}`) }}</span>
              </h2>
            </div>
            <div class="sheet">
            <ul class="stmt">
              <li v-for="row in group.rows" :key="row.asset.id">
                <router-link
                  class="stmt-row asset-row"
                  :to="`/tabs/holdings/asset/${row.asset.id}`"
                  :data-testid="`holding-${row.asset.symbol}`"
                >
                  <AssetIcon :src="row.asset.iconUrl" :symbol="row.asset.symbol" :size="28" />
                  <span class="stmt-main">
                    <span class="stmt-label">{{ row.asset.symbol }} <span class="name">{{ row.asset.name }}</span></span>
                    <span class="stmt-sub">
                      <span class="fig">{{ formatQuantity(row.quantity) }} {{ row.asset.symbol }}</span>
                      · {{ row.sources.length === 1 ? row.sources[0] : $t('ui.holdings.sources', { n: row.sources.length }) }}
                    </span>
                  </span>
                  <span class="stmt-value fig amount" :class="{ negative: isNegative(row.value) }">
                    {{ row.value === null ? '–' : formatCurrency(row.value, 'EUR') }}
                  </span>
                </router-link>
              </li>
            </ul>
            <div class="stmt-total">
              <span>{{ $t('ui.asset.total') }}</span>
              <span class="fig" :class="{ negative: isNegative(group.total) }">{{ formatCurrency(group.total, 'EUR') }}</span>
            </div>
            </div>
          </section>

          <ion-button
            v-if="unpricedCount > 0"
            fill="clear"
            size="small"
            class="unpriced-toggle"
            data-testid="toggle-unpriced"
            :aria-expanded="showUnpriced ? 'true' : 'false'"
            @click="showUnpriced = !showUnpriced"
          >
            {{ showUnpriced ? $t('holdings.hideUnpriced') : $t('holdings.showUnpriced', { n: unpricedCount }) }}
          </ion-button>

          <FuturesPositionsList v-if="portfolio.futuresPositions.length > 0" class="section" />
        </template>

        <section v-else class="empty-state" data-testid="holdings-empty">
          <h2>{{ $t('ui.empty.title') }}</h2>
          <p>{{ $t('holdings.empty') }}</p>
          <ion-button data-testid="add-holding-empty" @click="openAdd">
            <ion-icon slot="start" :icon="addOutline" aria-hidden="true" />
            {{ $t('holdings.addHolding') }}
          </ion-button>
          <p class="hint">
            <router-link to="/tabs/sources?add=exchange">{{ $t('ui.add.exchange.title') }}</router-link>
            ·
            <router-link to="/tabs/sources?add=wallet">{{ $t('ui.add.wallet.title') }}</router-link>
          </p>
        </section>
      </div>

      <AddHoldingModal :is-open="modalOpen" :edit-holding="null" @close="onModalClose" />
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
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue'
import { addOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AssetDto, HoldingAccountType } from '@crypto-tracker/shared'
import AppTopBar from '../components/AppTopBar.vue'
import AssetIcon from '../components/AssetIcon.vue'
import AllocationBar from '../components/AllocationBar.vue'
import AddHoldingModal from '../components/AddHoldingModal.vue'
import FuturesPositionsList from '../components/FuturesPositionsList.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ErrorState from '../components/ErrorState.vue'
import { usePortfolioStore } from '../stores/portfolio.store'
import { formatCurrency, formatQuantity } from '../services/format'
import { balancesHidden } from '../services/privacy'

const portfolio = usePortfolioStore()
const route = useRoute()
const router = useRouter()

const modalOpen = ref(false)
const pageLoading = ref(false)
const pageError = ref(false)
// spam/unknown tokens (without a price) are collapsed by default
const showUnpriced = ref(false)

const unpricedCount = computed(() => portfolio.holdings.filter((h) => h.valueEur === null).length)

interface AssetRow {
  asset: AssetDto
  quantity: string
  value: string | null
  sources: string[]
}

// Account type sections (fixed order), assets aggregated across sources
const ACCOUNT_ORDER: HoldingAccountType[] = ['SPOT', 'EARN', 'MARGIN', 'FUTURES']
const groups = computed(() =>
  ACCOUNT_ORDER.map((type) => {
    const byAsset = new Map<string, { asset: AssetDto; qty: number; value: number | null; sources: Set<string> }>()
    for (const h of portfolio.holdings) {
      if (h.accountType !== type) continue
      if (h.valueEur === null && !showUnpriced.value) continue
      const row = byAsset.get(h.asset.id) ?? { asset: h.asset, qty: 0, value: null, sources: new Set<string>() }
      row.qty += Number(h.quantity)
      if (h.valueEur !== null) row.value = (row.value ?? 0) + Number(h.valueEur)
      row.sources.add(h.sourceLabel)
      byAsset.set(h.asset.id, row)
    }
    const rows: AssetRow[] = [...byAsset.values()]
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
      .map((r) => ({
        asset: r.asset,
        quantity: String(r.qty),
        value: r.value === null ? null : r.value.toFixed(2),
        sources: [...r.sources],
      }))
    const total = rows.reduce((sum, r) => sum + Number(r.value ?? 0), 0).toFixed(2)
    return { type, rows, total }
  }).filter((g) => g.rows.length > 0),
)

// negative values (margin liability) in red — suppressed under the privacy mask
function isNegative(value: string | null): boolean {
  return !balancesHidden.value && value !== null && Number(value) < 0
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await Promise.all([portfolio.loadHoldings(), portfolio.loadFuturesPositions(), portfolio.loadSummary()])
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

function openAdd() {
  modalOpen.value = true
}

function onModalClose() {
  modalOpen.value = false
}

async function onPullRefresh(event: RefresherCustomEvent) {
  await portfolio.refresh()
  await event.target.complete()
}

onIonViewWillEnter(() => {
  void loadData()
  // onboarding entry point: /tabs/holdings?add=1 opens the entry modal directly
  if (route.query.add === '1') {
    openAdd()
    router.replace({ query: {} })
  }
})
</script>

<style scoped>
.asset-row {
  grid-template-columns: 28px minmax(0, 1fr) auto;
}
.name {
  font-weight: 400;
  color: var(--app-ink-2);
  font-size: var(--app-text-sm);
}
.unpriced-toggle {
  margin-top: var(--app-space-3);
}
</style>
