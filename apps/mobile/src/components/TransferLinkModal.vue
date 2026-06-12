<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('transactions.transferModalTitle') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="transfer-modal-cancel" @click="$emit('close')">{{
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

      <p class="hint">{{ $t('transactions.transferHint') }}</p>

      <ion-list v-if="candidates.length > 0">
        <ion-item
          v-for="c in candidates"
          :key="c.id"
          button
          :data-testid="`transfer-candidate-${c.asset.symbol}-${c.type}`"
          @click="select(c)"
        >
          <ion-label>
            <h3>{{ $t(`transactions.type${c.type}`) }} · {{ formatQuantity(c.quantity) }} {{ c.asset.symbol }}</h3>
            <p>{{ c.sourceLabel }} · {{ formatDate(c.timestamp) }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
      <p v-else class="hint" data-testid="transfer-no-candidates">{{ $t('transactions.noCandidates') }}</p>

      <ion-text v-if="error" color="danger">
        <p class="error" data-testid="transfer-error">{{ error }}</p>
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

// Einzahlung darf nominell bis 24 h vor der Auszahlung liegen (CSV-Tagesgranularität)
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

// Kandidaten clientseitig: Gegentyp, gleiches Asset, unverlinkt, Mengen-/Zeitregeln
const candidates = computed<TransactionDto[]>(() => {
  const tx = props.transaction
  if (!tx) return []
  const wantedType = tx.type === 'WITHDRAWAL' ? 'DEPOSIT' : 'WITHDRAWAL'
  return store.transactions
    .filter((c) => {
      if (c.id === tx.id || c.type !== wantedType || c.asset.id !== tx.asset.id || c.transferLink) return false
      const withdrawal = tx.type === 'WITHDRAWAL' ? tx : c
      const deposit = tx.type === 'DEPOSIT' ? tx : c
      if (Number(deposit.quantity) > Number(withdrawal.quantity)) return false
      return (
        new Date(deposit.timestamp).getTime() >=
        new Date(withdrawal.timestamp).getTime() - TIMESTAMP_TOLERANCE_MS
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
    await store.linkTransfer(props.transaction.id, candidate.id)
    emit('linked')
    emit('close')
  } catch (e) {
    error.value = apiErrorMessage(e, 'transactions.linkFailed')
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
