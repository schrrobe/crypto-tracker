<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/sources" text="" />
        </ion-buttons>
        <ion-title>Import-Historie</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-list v-if="importsStore.imports.length > 0" inset>
        <ion-item
          v-for="record in importsStore.imports"
          :key="record.id"
          :data-testid="`import-${record.filename}`"
        >
          <ion-label>
            <h3>{{ record.sourceLabel }}</h3>
            <p>{{ record.filename }} · {{ formatDate(record.createdAt) }}</p>
            <p>
              {{ record.importedRows }} von {{ record.totalRows }} Zeilen importiert
              <template v-if="record.errorRows.length > 0"> · {{ record.errorRows.length }} Fehler</template>
            </p>
            <ion-badge :color="badgeColor(record.status)">{{ statusLabel(record.status) }}</ion-badge>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button
              color="danger"
              :data-testid="`import-delete-${record.filename}`"
              @click="confirmDelete(record)"
            >
              <ion-icon :icon="trashOutline" slot="icon-only" />
            </ion-button>
          </ion-buttons>
        </ion-item>
      </ion-list>

      <div v-else class="empty" data-testid="imports-empty">
        <p>Noch keine CSV-Importe.</p>
      </div>
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
  IonContent,
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
import { trashOutline } from 'ionicons/icons'
import type { CsvImportDto } from '@crypto-tracker/shared'
import { useImportsStore } from '../../../stores/imports.store'
import { useSourcesStore } from '../../../stores/sources.store'
import { usePortfolioStore } from '../../../stores/portfolio.store'

const importsStore = useImportsStore()
const sourcesStore = useSourcesStore()
const portfolio = usePortfolioStore()

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

function statusLabel(status: CsvImportDto['status']): string {
  return status === 'COMPLETED' ? 'importiert' : status === 'FAILED' ? 'fehlgeschlagen' : 'offen'
}

function badgeColor(status: CsvImportDto['status']): string {
  return status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'danger' : 'medium'
}

async function confirmDelete(record: CsvImportDto) {
  const alert = await alertController.create({
    header: `Import „${record.sourceLabel}" löschen?`,
    message: 'Die zugehörige Quelle und alle importierten Bestände werden entfernt.',
    buttons: [
      { text: 'Abbrechen', role: 'cancel' },
      {
        text: 'Löschen',
        role: 'destructive',
        handler: () => {
          importsStore.remove(record.id).then(() => {
            sourcesStore.load()
            portfolio.loadSummary()
          })
        },
      },
    ],
  })
  await alert.present()
}

onIonViewWillEnter(() => {
  importsStore.load()
})
</script>

<style scoped>
.empty {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
ion-badge {
  margin-top: 4px;
}
</style>
