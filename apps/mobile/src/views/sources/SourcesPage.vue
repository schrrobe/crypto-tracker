<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Quellen</ion-title>
        <ion-buttons slot="end">
          <ion-button
            v-if="hasSyncable"
            data-testid="sync-all"
            :disabled="sourcesStore.syncing.size > 0"
            @click="syncAll"
          >
            <ion-icon :icon="syncOutline" slot="start" />
            Alle
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-list v-if="sourcesStore.sources.length > 0" inset>
        <ion-item
          v-for="source in sourcesStore.sources"
          :key="source.id"
          :data-testid="`source-${source.label}`"
        >
          <ion-label>
            <h3>{{ source.label }}</h3>
            <p>
              {{ providerLabel(source) }}
              <template v-if="source.keyPreview"> · Key {{ source.keyPreview }}</template>
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
        <p>Noch keine Quellen verbunden.</p>
        <ion-button fill="outline" data-testid="add-source-empty" @click="modalOpen = true">
          Quelle verbinden
        </ion-button>
      </div>

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button data-testid="add-source" @click="modalOpen = true">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>

      <AddSourceModal :is-open="modalOpen" @close="modalOpen = false" />
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
import { addOutline, syncOutline, trashOutline } from 'ionicons/icons'
import { computed, ref } from 'vue'
import type { SourceDto } from '@crypto-tracker/shared'
import AddSourceModal from './AddSourceModal.vue'
import SyncStatusBadge from '../../components/SyncStatusBadge.vue'
import { useSourcesStore } from '../../stores/sources.store'
import { usePortfolioStore } from '../../stores/portfolio.store'

const sourcesStore = useSourcesStore()
const portfolio = usePortfolioStore()

const modalOpen = ref(false)

const PROVIDER_LABELS: Record<string, string> = {
  COINBASE: 'Coinbase',
  KRAKEN: 'Kraken',
  BITVAVO: 'Bitvavo',
  BITPANDA: 'Bitpanda',
  BITCOIN: 'Bitcoin-Wallet',
  SOLANA: 'Solana-Wallet',
  GENERIC_CSV: 'CSV-Import',
  MANUAL: 'Manuelle Quelle',
}

const hasSyncable = computed(() => sourcesStore.sources.some(isSyncable))

function isSyncable(source: SourceDto): boolean {
  return source.type === 'EXCHANGE' || source.type === 'WALLET'
}

function providerLabel(source: SourceDto): string {
  return PROVIDER_LABELS[source.provider] ?? source.provider
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

async function confirmDelete(source: SourceDto) {
  const alert = await alertController.create({
    header: `„${source.label}" löschen?`,
    message: 'Alle Bestände dieser Quelle werden entfernt.',
    buttons: [
      { text: 'Abbrechen', role: 'cancel' },
      {
        text: 'Löschen',
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
  sourcesStore.load()
})
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
</style>
