<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <PortfolioSwitcher @switched="loadData" />
        </ion-buttons>
        <ion-title>{{ $t('tabs.sources') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="open-csv-import" @click="csvWizardOpen = true">
            <ion-icon :icon="documentAttachOutline" slot="icon-only" />
          </ion-button>
          <ion-button
            v-if="hasSyncable"
            data-testid="sync-all"
            :disabled="sourcesStore.syncing.size > 0"
            @click="syncAll"
          >
            <ion-icon :icon="syncOutline" slot="start" />
            {{ $t('sources.syncAll') }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <LoadingSkeleton v-if="pageLoading && sourcesStore.sources.length === 0" />
      <ErrorState v-else-if="pageError && sourcesStore.sources.length === 0" @retry="loadData" />
      <ion-list v-else-if="sourcesStore.sources.length > 0" inset>
        <ion-item
          v-for="source in sourcesStore.sources"
          :key="source.id"
          :data-testid="`source-${source.label}`"
        >
          <ion-label>
            <h3>{{ source.label }}</h3>
            <p>
              {{ providerLabel(source) }}
              <template v-if="source.keyPreview"> · {{ $t('sources.keyPreview', { preview: source.keyPreview }) }}</template>
              <template v-if="source.address"> · {{ shortAddress(source.address) }}</template>
            </p>
            <SyncStatusBadge :source="source" :syncing="sourcesStore.syncing.has(source.id)" />
          </ion-label>
          <ion-buttons slot="end">
            <ion-button
              v-if="isSyncable(source)"
              :disabled="sourcesStore.syncing.has(source.id)"
              :data-testid="`source-sync-${source.label}`"
              @click="sync(source)"
            >
              <ion-icon :icon="syncOutline" slot="icon-only" />
            </ion-button>
            <ion-button :data-testid="`source-rename-${source.label}`" @click="promptRename(source)">
              <ion-icon :icon="createOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              color="danger"
              :data-testid="`source-delete-${source.label}`"
              @click="confirmDelete(source)"
            >
              <ion-icon :icon="trashOutline" slot="icon-only" />
            </ion-button>
          </ion-buttons>
        </ion-item>
      </ion-list>

      <div v-else class="empty" data-testid="sources-empty">
        <p>{{ $t('sources.empty') }}</p>
        <ion-button fill="outline" data-testid="add-source-empty" @click="modalOpen = true">
          {{ $t('sources.connectSource') }}
        </ion-button>
      </div>

      <ion-button
        expand="block"
        fill="clear"
        size="small"
        router-link="/tabs/sources/imports"
        data-testid="open-import-history"
      >
        {{ $t('sources.importHistory') }}
      </ion-button>

      <ion-button
        expand="block"
        fill="clear"
        size="small"
        router-link="/tabs/sources/transactions"
        data-testid="open-transactions"
      >
        {{ $t('sources.transactions') }}
      </ion-button>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button data-testid="add-source" @click="modalOpen = true">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>

      <AddSourceModal :is-open="modalOpen" @close="modalOpen = false" />
      <CsvImportWizard :is-open="csvWizardOpen" @close="csvWizardOpen = false" @done="onImportDone" />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import { addOutline, createOutline, documentAttachOutline, syncOutline, trashOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { SourceDto } from '@crypto-tracker/shared'
import AddSourceModal from './AddSourceModal.vue'
import CsvImportWizard from './csv/CsvImportWizard.vue'
import PortfolioSwitcher from '../../components/PortfolioSwitcher.vue'
import LoadingSkeleton from '../../components/LoadingSkeleton.vue'
import ErrorState from '../../components/ErrorState.vue'
import SyncStatusBadge from '../../components/SyncStatusBadge.vue'
import { useSourcesStore } from '../../stores/sources.store'
import { usePortfolioStore } from '../../stores/portfolio.store'
import { t } from '../../i18n'

const sourcesStore = useSourcesStore()
const portfolio = usePortfolioStore()

const route = useRoute()
const router = useRouter()

const modalOpen = ref(false)
const csvWizardOpen = ref(false)
const pageLoading = ref(false)
const pageError = ref(false)

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await sourcesStore.load()
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

async function onImportDone() {
  await Promise.all([sourcesStore.load(), portfolio.loadSummary(), portfolio.loadHoldings()])
}

// Eigennamen bleiben, generische Labels kommen aus i18n
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
        handler: (values: { label: string }) => {
          const label = values.label.trim()
          if (label && label !== source.label) sourcesStore.rename(source.id, label)
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
  // Onboarding-Einstiege vom Dashboard
  if (route.query.add === '1') modalOpen.value = true
  if (route.query.csv === '1') csvWizardOpen.value = true
  if (route.query.add || route.query.csv) router.replace({ query: {} })
})
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
</style>
