<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('holdings.mapTitle', { symbol: asset?.symbol }) }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="mapping-cancel" @click="$emit('close')">{{ $t('common.cancel') }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-searchbar
        :debounce="250"
        :placeholder="$t('holdings.mapSearch')"
        data-testid="coingecko-search"
        @ionInput="search($event.detail.value ?? '')"
      />
      <ion-list>
        <ion-item
          v-for="coin in results"
          :key="coin.id"
          button
          :color="coin.id === selected?.id ? 'primary' : undefined"
          :data-testid="`coingecko-option-${coin.id}`"
          @click="selected = coin"
        >
          <ion-label>
            <h3>{{ coin.name }}</h3>
            <p>{{ coin.symbol.toUpperCase() }} · {{ coin.id }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
      <p v-if="searched && results.length === 0" class="hint">{{ $t('holdings.mapEmpty') }}</p>

      <ion-text v-if="error" color="danger">
        <p class="error" data-testid="mapping-error">{{ error }}</p>
      </ion-text>

      <ion-button
        expand="block"
        :disabled="!selected || saving"
        data-testid="mapping-save"
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
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSearchbar,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref, watch } from 'vue'
import type { AssetDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { apiErrorMessage } from '../services/errors'

interface CoinResult {
  id: string
  symbol: string
  name: string
}

const props = defineProps<{ isOpen: boolean; asset: AssetDto | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const results = ref<CoinResult[]>([])
const selected = ref<CoinResult | null>(null)
const searched = ref(false)
const error = ref('')
const saving = ref(false)

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return
    results.value = []
    selected.value = null
    searched.value = false
    error.value = ''
    // Vorbefüllung mit dem Symbol des Assets
    if (props.asset) await search(props.asset.symbol)
  },
)

async function search(q: string) {
  if (!q.trim()) {
    results.value = []
    return
  }
  const res = await api.get<{ coins: CoinResult[] }>(`/assets/coingecko-search?q=${encodeURIComponent(q)}`)
  results.value = res.coins
  searched.value = true
}

async function save() {
  if (!props.asset || !selected.value) return
  error.value = ''
  saving.value = true
  try {
    await api.post(`/assets/${props.asset.id}/mapping`, { coingeckoId: selected.value.id })
    emit('saved')
    emit('close')
  } catch (e) {
    error.value = apiErrorMessage(e, 'holdings.mapFailed')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.hint {
  color: var(--ion-color-medium);
  text-align: center;
  font-size: 0.9em;
}
.error {
  margin: 8px 4px;
  font-size: 0.9em;
}
</style>
