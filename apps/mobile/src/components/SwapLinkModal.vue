<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('transactions.swapModalTitle') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="swap-modal-cancel" @click="$emit('close')">{{
            $t('common.cancel')
          }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-item v-if="transaction" lines="none">
        <ion-label>
          <h3>{{ transaction.asset.symbol }} · {{ $t(`transactions.type${transaction.type}`) }}</h3>
          <p>{{ formatQuantity(transaction.quantity) }} · {{ transaction.sourceLabel }}</p>
        </ion-label>
      </ion-item>

      <p class="hint">{{ $t('transactions.swapHint') }}</p>

      <ion-list v-if="candidates.length > 0">
        <ion-item
          v-for="c in candidates"
          :key="c.id"
          button
          :data-testid="`swap-candidate-${c.asset.symbol}-${c.type}`"
          @click="select(c)"
        >
          <ion-label>
            <h3>{{ $t(`transactions.type${c.type}`) }} · {{ formatQuantity(c.quantity) }} {{ c.asset.symbol }}</h3>
            <p>{{ c.sourceLabel }} · {{ formatDate(c.timestamp) }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
      <p v-else class="hint" data-testid="swap-no-candidates">{{ $t('transactions.noCandidates') }}</p>

      <ion-text v-if="error" color="danger">
        <p class="error" data-testid="swap-error">{{ error }}</p>
      </ion-text>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { computed, ref, watch } from 'vue'
import type { TransactionDto } from '@crypto-tracker/shared'
import { apiErrorMessage } from '../services/errors'
import { formatQuantity, intlLocale } from '../services/format'
import { useTransactionsStore } from '../stores/transactions.store'

// Beide Legs dürfen bis 24 h auseinanderliegen (CSV-Tagesgranularität)
const TIMESTAMP_TOLERANCE_MS = 24 * 60 * 60 * 1000

const props = defineProps<{
  isOpen: boolean
  transaction: TransactionDto | null
}>()
const emit = defineEmits<{ close: []; linked: [] }>()

const store = useTransactionsStore()
const error = ref('')

watch(
  () => props.isOpen,
  (open) => {
    if (open) error.value = ''
  },
)

// Kandidaten: Gegentyp (SELL↔BUY), anderes Asset, unverlinkt, |Δt| ≤ 24 h
const candidates = computed<TransactionDto[]>(() => {
  const tx = props.transaction
  if (!tx) return []
  const wantedType = tx.type === 'SELL' ? 'BUY' : 'SELL'
  return store.transactions
    .filter((c) => {
      if (c.id === tx.id || c.type !== wantedType || c.asset.id === tx.asset.id || c.swapLink) return false
      return (
        Math.abs(new Date(c.timestamp).getTime() - new Date(tx.timestamp).getTime()) <=
        TIMESTAMP_TOLERANCE_MS
      )
    })
    .sort(
      (a, b) =>
        Math.abs(new Date(a.timestamp).getTime() - new Date(tx.timestamp).getTime()) -
        Math.abs(new Date(b.timestamp).getTime() - new Date(tx.timestamp).getTime()),
    )
})

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

async function select(candidate: TransactionDto): Promise<void> {
  if (!props.transaction) return
  error.value = ''
  try {
    await store.linkSwap(props.transaction.id, candidate.id)
    emit('linked')
    emit('close')
  } catch (e) {
    error.value = apiErrorMessage(e, 'transactions.swapLinkFailed')
  }
}
</script>

<style scoped>
.error,
.hint {
  margin: 8px 16px;
  font-size: 0.9em;
}
.hint {
  color: var(--ion-color-medium);
}
</style>
