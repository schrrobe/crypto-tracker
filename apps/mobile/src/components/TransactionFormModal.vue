<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ editTransaction ? $t('transactions.editTitle') : $t('transactions.addTitle') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="tx-modal-cancel" @click="$emit('close')">{{ $t('common.cancel') }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <template v-if="!editTransaction">
        <ion-searchbar
          :debounce="150"
          :placeholder="$t('holdings.searchPlaceholder')"
          data-testid="tx-asset-search"
          @ionInput="search($event.detail.value ?? '')"
        />
        <ion-list class="asset-list">
          <ion-item
            v-for="asset in assets"
            :key="asset.id"
            button
            :color="asset.id === selectedAsset?.id ? 'primary' : undefined"
            :data-testid="`tx-asset-option-${asset.symbol}`"
            @click="selectedAsset = asset"
          >
            <ion-label>
              <h3>{{ asset.symbol }}</h3>
              <p>{{ asset.name }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </template>

      <ion-item v-else lines="none">
        <ion-label>
          <h3>{{ editTransaction.asset.symbol }}</h3>
          <p>{{ editTransaction.asset.name }}</p>
        </ion-label>
      </ion-item>

      <ion-item>
        <ion-select
          :label="$t('transactions.type')"
          interface="popover"
          :value="type"
          data-testid="tx-type"
          @ionChange="type = $event.detail.value"
        >
          <ion-select-option v-for="t in TX_TYPES" :key="t" :value="t">
            {{ $t(`transactions.type${t}`) }}
          </ion-select-option>
        </ion-select>
      </ion-item>

      <ion-item>
        <ion-input
          v-model="quantity"
          :label="$t('transactions.quantity')"
          label-placement="floating"
          inputmode="decimal"
          :placeholder="$t('holdings.quantityPlaceholder')"
          data-testid="tx-quantity"
        />
      </ion-item>

      <ion-item>
        <ion-input
          v-model="timestamp"
          type="datetime-local"
          :label="$t('transactions.date')"
          label-placement="floating"
          data-testid="tx-timestamp"
        />
      </ion-item>

      <ion-item>
        <ion-input
          v-model="price"
          :label="$t('transactions.price')"
          label-placement="floating"
          inputmode="decimal"
          data-testid="tx-price"
        />
      </ion-item>

      <ion-item>
        <ion-input
          v-model="fee"
          :label="$t('transactions.fee')"
          label-placement="floating"
          inputmode="decimal"
          data-testid="tx-fee"
        />
      </ion-item>

      <ion-item>
        <ion-select
          :label="$t('transactions.currency')"
          interface="popover"
          :value="currency"
          data-testid="tx-currency"
          @ionChange="currency = $event.detail.value"
        >
          <ion-select-option value="EUR">EUR</ion-select-option>
          <ion-select-option value="USD">USD</ion-select-option>
        </ion-select>
      </ion-item>

      <ion-text color="medium">
        <p class="hint">{{ $t('transactions.priceHint') }}</p>
      </ion-text>

      <ion-text v-if="error" color="danger">
        <p class="error" data-testid="tx-error">{{ error }}</p>
      </ion-text>

      <ion-button
        expand="block"
        class="ion-margin-top"
        :disabled="saving || (!editTransaction && !selectedAsset) || !quantity || !timestamp"
        data-testid="tx-save"
        @click="save"
      >
        {{ $t('common.save') }}
      </ion-button>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref, watch } from 'vue'
import type { AssetDto, TransactionDto, TxType } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { apiErrorMessage } from '../services/errors'
import { useTransactionsStore } from '../stores/transactions.store'

const TX_TYPES: TxType[] = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'STAKING_REWARD', 'OTHER']

const props = defineProps<{
  isOpen: boolean
  editTransaction?: TransactionDto | null
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const transactionsStore = useTransactionsStore()

const assets = ref<AssetDto[]>([])
const selectedAsset = ref<AssetDto | null>(null)
const type = ref<TxType>('BUY')
const quantity = ref('')
const price = ref('')
const fee = ref('')
const currency = ref('EUR')
const timestamp = ref('')
const error = ref('')
const saving = ref(false)

// ISO → value for <input type="datetime-local"> (local time, minute resolution)
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return
    error.value = ''
    saving.value = false
    selectedAsset.value = null
    if (props.editTransaction) {
      const tx = props.editTransaction
      type.value = tx.type
      quantity.value = tx.quantity
      price.value = tx.pricePerUnit ?? ''
      fee.value = tx.feeAmount ?? ''
      currency.value = tx.currency ?? 'EUR'
      timestamp.value = toLocalInput(tx.timestamp)
    } else {
      type.value = 'BUY'
      quantity.value = ''
      price.value = ''
      fee.value = ''
      currency.value = 'EUR'
      timestamp.value = ''
      await search('')
    }
  },
)

async function search(q: string): Promise<void> {
  const res = await api.get<{ assets: AssetDto[] }>(`/assets/search?q=${encodeURIComponent(q)}`)
  assets.value = res.assets
}

function buildInput() {
  return {
    type: type.value,
    quantity: quantity.value.trim(),
    pricePerUnit: price.value.trim() || undefined,
    feeAmount: fee.value.trim() || undefined,
    currency: currency.value,
    timestamp: new Date(timestamp.value).toISOString(),
  }
}

async function save(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    if (props.editTransaction) {
      await transactionsStore.update(props.editTransaction.id, buildInput())
    } else {
      await transactionsStore.create({ assetId: selectedAsset.value!.id, ...buildInput() })
    }
    emit('saved')
    emit('close')
  } catch (e) {
    error.value = apiErrorMessage(e, 'transactions.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.asset-list {
  max-height: 180px;
  overflow-y: auto;
}
.error,
.hint {
  margin: 8px 16px;
  font-size: 0.9em;
}
</style>
