<template>
  <ion-page>
    <AppTopBar :title="$t('tabs.sources')" :show-privacy="false" @switched="loadData">
      <template #end>
        <ion-button
          data-testid="add-source"
          :aria-label="$t('ui.add.open')"
          :title="$t('ui.add.open')"
          @click="openAddSheet"
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
        <LoadingSkeleton v-if="pageLoading && sourcesStore.sources.length === 0" />
        <ErrorState v-else-if="pageError && sourcesStore.sources.length === 0" @retry="loadData" />
        <template v-else-if="sourcesStore.sources.length > 0">
          <section aria-labelledby="sources-title">
            <div class="section-head">
              <h2 id="sources-title" class="section-title">{{ $t('ui.sources.connected') }}</h2>
              <ion-button
                v-if="hasSyncable"
                size="small"
                fill="outline"
                data-testid="sync-all"
                :disabled="sourcesStore.syncing.size > 0"
                @click="syncAll"
              >
                <ion-icon slot="start" :icon="syncOutline" aria-hidden="true" />
                {{ $t('ui.sources.syncAll') }}
              </ion-button>
            </div>
            <div class="sheet">
            <ul class="stmt">
              <li v-for="source in sourcesStore.sources" :key="source.id" :data-testid="`source-${source.label}`" class="source">
                <div class="source-top">
                  <span class="stmt-main">
                    <span class="stmt-label">{{ source.label }}</span>
                    <span class="stmt-sub">
                      {{ providerLabel(source) }}
                      <template v-if="source.keyPreview"> · {{ $t('sources.keyPreview', { preview: source.keyPreview }) }}</template>
                      <template v-if="source.address"> · <span class="fig">{{ shortAddress(source.address) }}</span></template>
                    </span>
                  </span>
                  <span class="stmt-value fig">{{ formatCurrency(sourceValue(source.id), 'EUR') }}</span>
                </div>
                <div class="source-foot">
                  <SyncStatusBadge :source="source" :syncing="sourcesStore.syncing.has(source.id)" />
                  <span class="actions">
                    <button
                      v-if="isSyncable(source)"
                      type="button"
                      class="act"
                      :disabled="sourcesStore.syncing.has(source.id)"
                      :aria-label="`${$t('sources.syncOne')}: ${source.label}`"
                      :data-testid="`source-sync-${source.label}`"
                      @click="sync(source)"
                    >
                      <ion-icon :icon="syncOutline" aria-hidden="true" />
                      <span>{{ $t('ui.sources.sync') }}</span>
                    </button>
                    <!-- Rare, destructive actions live one tap deeper -->
                    <button
                      type="button"
                      class="act"
                      :aria-label="`${$t('ui.sources.more')}: ${source.label}`"
                      :data-testid="`source-more-${source.label}`"
                      @click="openMore(source)"
                    >
                      <ion-icon :icon="ellipsisHorizontal" aria-hidden="true" />
                      <span>{{ $t('ui.sources.more') }}</span>
                    </button>
                  </span>
                </div>
              </li>
            </ul>
            <div class="stmt-total sources-total">
              <span>{{ $t('ui.overview.saldo') }}</span>
              <span class="fig">{{ formatCurrency(sourcesSaldo, 'EUR') }}</span>
            </div>
            </div>
            <p v-if="!auth.isPro" class="hint" data-testid="source-count">
              <ion-icon v-if="sourcesAtLimit" :icon="lockClosedOutline" aria-hidden="true" />
              {{ $t('sources.countLimit', { used: sourceTotal, limit: FREE_LIMITS.sources }) }}
            </p>
          </section>

        </template>

        <section v-else class="empty-state" data-testid="sources-empty">
          <h2>{{ $t('sources.empty') }}</h2>
          <p>{{ $t('ui.empty.body') }}</p>
          <AddOptions mode="emit" prefix="add-empty" @chosen="onChosen" />
          <p v-if="!auth.isPro" class="hint" data-testid="source-count">
            {{ $t('sources.countLimit', { used: sourceTotal, limit: FREE_LIMITS.sources }) }}
          </p>
        </section>

        <!-- Imports and transactions: the paper trail behind the numbers. Always reachable:
             manual transactions create their own source, so they must work with none. -->
        <section v-if="!(pageLoading && sourcesStore.sources.length === 0)" class="section" aria-labelledby="data-title">
          <div class="section-head">
            <h2 id="data-title" class="section-title">{{ $t('ui.sources.data') }}</h2>
          </div>
          <ul class="stmt sheet">
            <li>
              <button type="button" class="stmt-row link-row" data-testid="open-csv-import" @click="openCsv">
                <ion-icon :icon="documentTextOutline" aria-hidden="true" />
                <span class="stmt-label">{{ $t('csv.title') }}</span>
                <ion-icon class="chev" :icon="chevronForward" aria-hidden="true" />
              </button>
            </li>
            <li>
              <router-link class="stmt-row link-row" to="/tabs/sources/imports" data-testid="open-import-history">
                <ion-icon :icon="timeOutline" aria-hidden="true" />
                <span class="stmt-label">{{ $t('sources.importHistory') }}</span>
                <ion-icon class="chev" :icon="chevronForward" aria-hidden="true" />
              </router-link>
            </li>
            <li>
              <router-link class="stmt-row link-row" to="/tabs/sources/transactions" data-testid="open-transactions">
                <ion-icon :icon="swapHorizontalOutline" aria-hidden="true" />
                <span class="stmt-label">{{ $t('sources.transactions') }}</span>
                <ion-icon class="chev" :icon="chevronForward" aria-hidden="true" />
              </router-link>
            </li>
          </ul>
        </section>
      </div>

      <!-- The one add entry point: four ways in -->
      <ion-modal
        :is-open="addSheetOpen"
        :initial-breakpoint="1"
        :breakpoints="[0, 1]"
        class="add-sheet"
        @didDismiss="addSheetOpen = false"
      >
        <div class="sheet-body">
          <h2 class="sheet-heading">{{ $t('ui.add.title') }}</h2>
          <AddOptions mode="emit" prefix="add" @chosen="onChosen" />
        </div>
      </ion-modal>

      <AddSourceModal :is-open="modalOpen" :initial-type="modalType" @close="modalOpen = false" />
      <CsvImportWizard :is-open="csvWizardOpen" @close="csvWizardOpen = false" @done="onImportDone" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  actionSheetController,
  alertController,
  toastController,
  IonButton,
  IonContent,
  IonIcon,
  IonModal,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  onIonViewWillEnter,
  type RefresherCustomEvent,
} from '@ionic/vue'
import {
  addOutline,
  chevronForward,
  documentTextOutline,
  ellipsisHorizontal,
  lockClosedOutline,
  swapHorizontalOutline,
  syncOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FREE_LIMITS, type SourceDto } from '@crypto-tracker/shared'
import AddSourceModal from './AddSourceModal.vue'
import CsvImportWizard from './csv/CsvImportWizard.vue'
import AppTopBar from '../../components/AppTopBar.vue'
import AddOptions, { type AddKind } from '../../components/AddOptions.vue'
import LoadingSkeleton from '../../components/LoadingSkeleton.vue'
import ErrorState from '../../components/ErrorState.vue'
import SyncStatusBadge from '../../components/SyncStatusBadge.vue'
import { useSourcesStore } from '../../stores/sources.store'
import { usePortfolioStore } from '../../stores/portfolio.store'
import { usePortfoliosStore } from '../../stores/portfolios.store'
import { useAuthStore } from '../../stores/auth.store'
import { openPaywall } from '../../services/paywall'
import { formatCurrency } from '../../services/format'
import { t } from '../../i18n'

const sourcesStore = useSourcesStore()
const portfolio = usePortfolioStore()
const portfolios = usePortfoliosStore()
const auth = useAuthStore()

// The Free source limit is user-wide (across all portfolios), so sum the
// per-portfolio counts rather than the active-portfolio scoped list.
const sourceTotal = computed(() =>
  portfolios.portfolios.reduce((n, p) => n + (p.sourceCount ?? 0), 0),
)
const sourcesAtLimit = computed(() => !auth.isPro && sourceTotal.value >= FREE_LIMITS.sources)
function onAddSource(kind: 'EXCHANGE' | 'WALLET' | 'MANUAL' = 'EXCHANGE') {
  // Pre-empt the server 402: don't let a Free user fill the whole connect form
  // (and create a real exchange API key) only to be rejected on save.
  if (sourcesAtLimit.value) {
    openPaywall('unlimitedSources')
    return
  }
  modalType.value = kind
  modalOpen.value = true
}

function openAddSheet() {
  addSheetOpen.value = true
}

function openCsv() {
  csvWizardOpen.value = true
}

// The sheet closes first so the next modal never stacks on top of it
async function onChosen(kind: AddKind) {
  addSheetOpen.value = false
  if (kind === 'exchange') onAddSource('EXCHANGE')
  else if (kind === 'wallet') onAddSource('WALLET')
  else if (kind === 'csv') openCsv()
  else router.push('/tabs/holdings?add=1')
}

// Rename / delete behind one "more" sheet; testids ride on the sheet buttons
async function openMore(source: SourceDto) {
  const sheet = await actionSheetController.create({
    header: source.label,
    buttons: [
      {
        text: t('ui.sources.rename'),
        htmlAttributes: { 'data-testid': `source-rename-${source.label}` },
        handler: () => {
          void promptRename(source)
        },
      },
      {
        text: t('common.delete'),
        role: 'destructive',
        htmlAttributes: { 'data-testid': `source-delete-${source.label}` },
        handler: () => {
          void confirmDelete(source)
        },
      },
      { text: t('common.cancel'), role: 'cancel' },
    ],
  })
  await sheet.present()
}

const sourcesSaldo = computed(() =>
  sourcesStore.sources.reduce((sum, s) => sum + Number(sourceValue(s.id)), 0).toFixed(2),
)

// Value per source from its priced holdings (the same numbers as the overview)
function sourceValue(sourceId: string): string {
  return portfolio.holdings
    .filter((h) => h.sourceId === sourceId && h.valueEur !== null)
    .reduce((sum, h) => sum + Number(h.valueEur), 0)
    .toFixed(2)
}

const route = useRoute()
const router = useRouter()

const modalOpen = ref(false)
const modalType = ref<'EXCHANGE' | 'WALLET' | 'MANUAL'>('EXCHANGE')
const addSheetOpen = ref(false)
const csvWizardOpen = ref(false)
const pageLoading = ref(false)
const pageError = ref(false)

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await Promise.all([sourcesStore.load(), portfolios.load(), portfolio.loadHoldings()])
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

async function onImportDone() {
  await Promise.all([sourcesStore.load(), portfolio.loadSummary(), portfolio.loadHoldings()])
}

// Proper names stay, generic labels come from i18n
function providerLabelKey(provider: string): string | null {
  return (
    {
      BITCOIN: 'sources.providerBitcoin',
      SOLANA: 'sources.providerSolana',
      ETHEREUM: 'sources.providerEthereum',
      GENERIC_CSV: 'sources.providerCsv',
      MANUAL: 'sources.providerManual',
    }[provider] ?? null
  )
}

const PROVIDER_NAMES: Record<string, string> = {
  COINBASE: 'Coinbase',
  KRAKEN: 'Kraken',
  BITVAVO: 'Bitvavo',
  BITPANDA: 'Bitpanda',
  BINANCE: 'Binance',
  OKX: 'OKX',
  BYBIT: 'Bybit',
  KUCOIN: 'KuCoin',
  BITSTAMP: 'Bitstamp',
  GATEIO: 'Gate.io',
  CRYPTOCOM: 'Crypto.com',
  POLYGON: 'Polygon',
  ARBITRUM: 'Arbitrum',
  BASE: 'Base',
  BSC: 'BNB Smart Chain',
  LITECOIN: 'Litecoin',
  DOGECOIN: 'Dogecoin',
  CARDANO: 'Cardano',
  XRP: 'XRP Ledger',
  TRON: 'Tron',
  COSMOS: 'Cosmos Hub',
}

const hasSyncable = computed(() => sourcesStore.sources.some(isSyncable))

function isSyncable(source: SourceDto): boolean {
  return source.type === 'EXCHANGE' || source.type === 'WALLET'
}

function providerLabel(source: SourceDto): string {
  const key = providerLabelKey(source.provider)
  if (key) return t(key)
  return PROVIDER_NAMES[source.provider] ?? source.provider
}

function shortAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address
}

async function sync(source: SourceDto) {
  await sourcesStore.sync(source.id)
  await Promise.all([portfolio.loadSummary(), portfolio.loadHoldings()])
}

async function onPullRefresh(event: RefresherCustomEvent) {
  await loadData()
  await event.target.complete()
}

async function syncAll() {
  await sourcesStore.syncAll()
  await Promise.all([portfolio.loadSummary(), portfolio.loadHoldings()])
}

async function promptRename(source: SourceDto) {
  const alert = await alertController.create({
    header: t('sources.renameTitle'),
    inputs: [{ name: 'label', type: 'text', value: source.label, attributes: { maxlength: 60 } }],
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.save'),
        handler: async (values: { label: string }) => {
          const label = values.label.trim()
          if (!label || label === source.label) return
          try {
            await sourcesStore.rename(source.id, label)
          } catch {
            // Without this, a failed PATCH silently left the old label on screen.
            const toast = await toastController.create({
              message: t('sources.renameFailed'),
              duration: 3000,
              color: 'danger',
            })
            await toast.present()
          }
        },
      },
    ],
  })
  await alert.present()
}

async function confirmDelete(source: SourceDto) {
  const alert = await alertController.create({
    header: t('sources.deleteTitle', { label: source.label }),
    message: t('sources.deleteMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.delete'),
        role: 'destructive',
        handler: () => {
          sourcesStore.remove(source.id).then(() => portfolio.loadSummary())
        },
      },
    ],
  })
  await alert.present()
}

onIonViewWillEnter(() => {
  loadData()
  // Onboarding entry points from the dashboard — route the add path through the
  // same quota guard so a Free user at the cap hits the paywall, not the form.
  if (route.query.add === '1' || route.query.add === 'exchange') onAddSource('EXCHANGE')
  if (route.query.add === 'wallet') onAddSource('WALLET')
  if (route.query.csv === '1') csvWizardOpen.value = true
  if (route.query.add || route.query.csv) router.replace({ query: {} })
})
</script>

<style scoped>
.section-head {
  align-items: center;
}
.source {
  padding: var(--app-space-3) var(--app-space-4) var(--app-space-2);
  border-top: 1px solid var(--app-rule);
}
.source:first-child {
  border-top: 0;
}
.source-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: var(--app-space-3);
  align-items: baseline;
}
.source-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--app-space-1) var(--app-space-3);
  margin-top: var(--app-space-2);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  margin-right: calc(-1 * var(--app-space-2));
}
.act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: var(--app-touch);
  padding: 0 var(--app-space-2);
  background: none;
  border: 0;
  font: inherit;
  font-size: var(--app-text-sm);
  font-weight: 600;
  color: var(--app-accent);
  cursor: pointer;
}
.act:disabled {
  opacity: 0.45;
  cursor: default;
}
.act--danger {
  color: var(--app-loss);
}
.link-row {
  grid-template-columns: 20px minmax(0, 1fr) 16px;
}
.link-row > ion-icon:first-child {
  font-size: 1.125rem;
  color: var(--app-ink-2);
}
.chev {
  color: var(--app-ink-3);
}
.hint ion-icon {
  vertical-align: -2px;
}
.add-sheet {
  --height: auto;
}
.sheet-body {
  padding: var(--app-space-5) var(--app-space-4) calc(var(--app-space-5) + env(safe-area-inset-bottom, 0px));
}
.sheet-heading {
  margin: 0 0 var(--app-space-3);
  font-size: var(--app-text-xl);
  font-weight: 650;
}
</style>
