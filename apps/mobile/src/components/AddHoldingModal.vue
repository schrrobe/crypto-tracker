<template>
  <ion-modal :is-open="isOpen" @didDismiss="$emit('close')">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ editHolding ? 'Bestand bearbeiten' : 'Bestand hinzufügen' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="holding-modal-cancel" @click="$emit('close')">Abbrechen</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <template v-if="!editHolding">
        <ion-searchbar
          :debounce="150"
          placeholder="Asset suchen (z.B. BTC)"
          data-testid="asset-search"
          @ionInput="search($event.detail.value ?? '')"
        />
        <ion-list>
          <ion-item
            v-for="asset in assets"
            :key="asset.id"
            button
            :color="asset.id === selectedAsset?.id ? 'primary' : undefined"
            :data-testid="`asset-option-${asset.symbol}`"
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
          <h3>{{ editHolding.asset.symbol }}</h3>
          <p>{{ editHolding.asset.name }}</p>
        </ion-label>
      </ion-item>

      <ion-item>
        <ion-input
          v-model="quantity"
          label="Menge"
          label-placement="floating"
          inputmode="decimal"
          placeholder="z.B. 0,5"
          data-testid="holding-quantity"
        />
      </ion-item>

      <ion-text v-if="error" color="danger">
        <p class="error" data-testid="holding-error">{{ error }}</p>
      </ion-text>

      <ion-button
        expand="block"
        class="ion-margin-top"
        :disabled="saving || (!editHolding && !selectedAsset) || !quantity"
        data-testid="holding-save"
        @click="save"
      >
        Speichern
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
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref, watch } from 'vue'
import type { AssetDto, HoldingDto } from '@crypto-tracker/shared'
import { api, ApiError } from '../services/api.client'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'

const props = defineProps<{
  isOpen: boolean
  editHolding?: HoldingDto | null
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const portfolio = usePortfolioStore()
const sourcesStore = useSourcesStore()

const assets = ref<AssetDto[]>([])
const selectedAsset = ref<AssetDto | null>(null)
const quantity = ref('')
const error = ref('')
const saving = ref(false)

watch(
  () => props.isOpen,
  async (open) => {
    if (!open) return
    error.value = ''
    saving.value = false
    quantity.value = props.editHolding ? props.editHolding.quantity : ''
    selectedAsset.value = null
    if (!props.editHolding) await search('')
  },
)

async function search(q: string): Promise<void> {
  const res = await api.get<{ assets: AssetDto[] }>(`/assets/search?q=${encodeURIComponent(q)}`)
  assets.value = res.assets
}

async function save(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    if (props.editHolding) {
      await portfolio.updateHolding(props.editHolding.sourceId, props.editHolding.id, quantity.value)
    } else {
      const source = await sourcesStore.ensureManualSource()
      await portfolio.createHolding(source.id, selectedAsset.value!.id, quantity.value)
    }
    emit('saved')
    emit('close')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.error {
  margin: 8px 16px;
  font-size: 0.9em;
}
</style>
