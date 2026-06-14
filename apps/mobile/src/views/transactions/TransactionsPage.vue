<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/sources" />
        </ion-buttons>
        <ion-title>{{ $t('transactions.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-chip v-if="filterLabel" data-testid="tx-source-filter" @click="clearFilter">
        {{ $t('transactions.filteredBySource', { source: filterLabel }) }}
        <ion-icon :icon="closeCircleOutline" />
      </ion-chip>

      <LoadingSkeleton v-if="pageLoading && store.transactions.length === 0" />
      <ErrorState v-else-if="pageError && store.transactions.length === 0" @retry="loadData" />

      <ion-list v-else-if="store.transactions.length > 0" inset>
        <ion-item
          v-for="tx in store.transactions"
          :key="tx.id"
          :data-testid="`tx-${tx.asset.symbol}-${tx.type}`"
        >
          <ion-label>
            <h3>
              {{ tx.asset.symbol }} · {{ $t(`transactions.type${tx.type}`) }}
              <ion-badge v-if="!tx.editable" color="medium">{{ $t('transactions.importedBadge') }}</ion-badge>
              <ion-badge
                v-if="tx.transferLink"
                color="tertiary"
                :data-testid="`tx-transfer-badge-${tx.asset.symbol}`"
              >
                {{ $t('transactions.transferBadge', { source: tx.transferLink.counterpartSourceLabel }) }}
              </ion-badge>
              <ion-badge
                v-if="tx.swapLink"
                color="success"
                :data-testid="`tx-swap-badge-${tx.asset.symbol}`"
              >
                {{ $t('transactions.swapBadge', { asset: tx.swapLink.counterpartAssetSymbol }) }}
              </ion-badge>
            </h3>
            <p>
              {{ formatQuantity(tx.quantity) }}
              <template v-if="tx.pricePerUnit"> · {{ tx.pricePerUnit }} {{ tx.currency ?? '' }}</template>
              · {{ formatDate(tx.timestamp) }}
            </p>
            <p>{{ tx.sourceLabel }}</p>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button
              v-if="isLinkable(tx)"
              :data-testid="`tx-link-${tx.asset.symbol}`"
              @click="openLink(tx)"
            >
              <ion-icon :icon="gitMergeOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              v-if="tx.transferLink"
              :data-testid="`tx-unlink-${tx.asset.symbol}`"
              @click="confirmUnlink(tx)"
            >
              <ion-icon :icon="unlinkOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              v-if="isSwapLinkable(tx)"
              :data-testid="`tx-swap-link-${tx.asset.symbol}`"
              @click="openSwap(tx)"
            >
              <ion-icon :icon="swapHorizontalOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              v-if="tx.swapLink"
              :data-testid="`tx-swap-unlink-${tx.asset.symbol}`"
              @click="confirmUnlinkSwap(tx)"
            >
              <ion-icon :icon="unlinkOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              v-if="tx.editable"
              :data-testid="`tx-edit-${tx.asset.symbol}`"
              @click="openEdit(tx)"
            >
              <ion-icon :icon="createOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              v-if="tx.editable"
              color="danger"
              :data-testid="`tx-delete-${tx.asset.symbol}`"
              @click="confirmDelete(tx)"
            >
              <ion-icon :icon="trashOutline" slot="icon-only" />
            </ion-button>
          </ion-buttons>
        </ion-item>
      </ion-list>

      <div v-else class="empty" data-testid="transactions-empty">
        <p>{{ $t('transactions.empty') }}</p>
        <ion-button fill="outline" data-testid="add-transaction-empty" @click="openCreate">
          {{ $t('transactions.addTitle') }}
        </ion-button>
      </div>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button data-testid="add-transaction" @click="openCreate">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>

      <TransactionFormModal
        :is-open="modalOpen"
        :edit-transaction="editTransaction"
        @close="modalOpen = false"
        @saved="onSaved"
      />
      <TransferLinkModal
        :is-open="linkModalOpen"
        :transaction="linkTransaction"
        @close="linkModalOpen = false"
        @linked="onSaved"
      />
      <SwapLinkModal
        :is-open="swapModalOpen"
        :transaction="swapTransaction"
        @close="swapModalOpen = false"
        @linked="onSaved"
      />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonChip,
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
import {
  addOutline,
  closeCircleOutline,
  createOutline,
  gitMergeOutline,
  swapHorizontalOutline,
  trashOutline,
  unlinkOutline,
} from 'ionicons/icons'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { TransactionDto } from '@crypto-tracker/shared'
import TransactionFormModal from '../../components/TransactionFormModal.vue'
import TransferLinkModal from '../../components/TransferLinkModal.vue'
import SwapLinkModal from '../../components/SwapLinkModal.vue'
import LoadingSkeleton from '../../components/LoadingSkeleton.vue'
import ErrorState from '../../components/ErrorState.vue'
import { useTransactionsStore } from '../../stores/transactions.store'
import { usePortfolioStore } from '../../stores/portfolio.store'
import { formatQuantity, intlLocale } from '../../services/format'
import { t } from '../../i18n'

const store = useTransactionsStore()
const portfolio = usePortfolioStore()
const route = useRoute()
const router = useRouter()

const pageLoading = ref(false)
const pageError = ref(false)

// Derive the label of the filtered source from the loaded transactions
const filterLabel = computed(() => {
  if (!store.filterSourceId) return null
  return store.transactions.find((t) => t.sourceId === store.filterSourceId)?.sourceLabel ?? '…'
})

async function clearFilter() {
  await router.replace({ query: {} })
  await store.load({ sourceId: null })
}
const modalOpen = ref(false)
const editTransaction = ref<TransactionDto | null>(null)
const linkModalOpen = ref(false)
const linkTransaction = ref<TransactionDto | null>(null)
const swapModalOpen = ref(false)
const swapTransaction = ref<TransactionDto | null>(null)

// only unlinked withdrawals/deposits can be linked as a transfer
function isLinkable(tx: TransactionDto): boolean {
  return !tx.transferLink && (tx.type === 'WITHDRAWAL' || tx.type === 'DEPOSIT')
}

// only unlinked buys/sells can be linked as a crypto-to-crypto swap
function isSwapLinkable(tx: TransactionDto): boolean {
  return !tx.swapLink && (tx.type === 'BUY' || tx.type === 'SELL')
}

function openLink(tx: TransactionDto) {
  linkTransaction.value = tx
  linkModalOpen.value = true
}

function openSwap(tx: TransactionDto) {
  swapTransaction.value = tx
  swapModalOpen.value = true
}

async function confirmUnlink(tx: TransactionDto) {
  const alert = await alertController.create({
    header: t('transactions.unlinkTitle'),
    message: t('transactions.unlinkMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('transactions.unlink'),
        role: 'destructive',
        handler: () => {
          store.unlinkTransfer(tx.id)
        },
      },
    ],
  })
  await alert.present()
}

async function confirmUnlinkSwap(tx: TransactionDto) {
  const alert = await alertController.create({
    header: t('transactions.swapUnlinkTitle'),
    message: t('transactions.swapUnlinkMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('transactions.unlink'),
        role: 'destructive',
        handler: () => {
          store.unlinkSwap(tx.id).then(() => onSaved())
        },
      },
    ],
  })
  await alert.present()
}

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    const sourceId = typeof route.query.sourceId === 'string' ? route.query.sourceId : null
    await store.load({ sourceId })
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

function openCreate() {
  editTransaction.value = null
  modalOpen.value = true
}

function openEdit(tx: TransactionDto) {
  editTransaction.value = tx
  modalOpen.value = true
}

async function onSaved() {
  await Promise.all([portfolio.loadSummary(), portfolio.loadHoldings()])
}

async function confirmDelete(tx: TransactionDto) {
  const alert = await alertController.create({
    header: t('transactions.deleteTitle'),
    message: t('transactions.deleteMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.delete'),
        role: 'destructive',
        handler: () => {
          store.remove(tx.id).then(() => onSaved())
        },
      },
    ],
  })
  await alert.present()
}

onIonViewWillEnter(() => {
  loadData()
})
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
</style>
