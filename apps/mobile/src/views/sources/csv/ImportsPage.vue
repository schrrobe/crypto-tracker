<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/sources" text="" />
        </ion-buttons>
        <ion-title>{{ $t('imports.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <LoadingSkeleton v-if="pageLoading && importsStore.imports.length === 0" />
      <ErrorState v-else-if="pageError && importsStore.imports.length === 0" @retry="loadData" />
      <ion-list v-else-if="importsStore.imports.length > 0" inset>
        <ion-item
          v-for="record in importsStore.imports"
          :key="record.id"
          :data-testid="`import-${record.filename}`"
        >
          <ion-label>
            <h3>{{ record.sourceLabel }}</h3>
            <p>{{ record.filename }} · {{ formatDate(record.createdAt) }}</p>
            <p>
              {{ $t('csv.result', { imported: record.importedRows, total: record.totalRows }) }}
              <template v-if="record.errorRows.length > 0">
                · {{ $t('imports.errorsCount', { n: record.errorRows.length }) }}
              </template>
            </p>
            <ion-badge :color="badgeColor(record.status)">{{ statusLabel(record.status) }}</ion-badge>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button
              v-if="record.kind === 'TRANSACTIONS' && record.status === 'COMPLETED'"
              :data-testid="`import-transactions-${record.filename}`"
              :router-link="`/tabs/sources/transactions?sourceId=${record.sourceId}`"
            >
              <ion-icon :icon="listOutline" slot="icon-only" />
            </ion-button>
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
        <p>{{ $t('imports.empty') }}</p>
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
import { listOutline, trashOutline } from 'ionicons/icons'
import { ref } from 'vue'
import type { CsvImportDto } from '@crypto-tracker/shared'
import LoadingSkeleton from '../../../components/LoadingSkeleton.vue'
import ErrorState from '../../../components/ErrorState.vue'
import { useImportsStore } from '../../../stores/imports.store'
import { useSourcesStore } from '../../../stores/sources.store'
import { usePortfolioStore } from '../../../stores/portfolio.store'
import { intlLocale, t } from '../../../i18n'

const importsStore = useImportsStore()
const sourcesStore = useSourcesStore()
const portfolio = usePortfolioStore()

const pageLoading = ref(false)
const pageError = ref(false)

async function loadData() {
  pageLoading.value = true
  pageError.value = false
  try {
    await importsStore.load()
  } catch {
    pageError.value = true
  } finally {
    pageLoading.value = false
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
}

function statusLabel(status: CsvImportDto['status']): string {
  return status === 'COMPLETED'
    ? t('imports.statusCompleted')
    : status === 'FAILED'
      ? t('imports.statusFailed')
      : t('imports.statusPending')
}

function badgeColor(status: CsvImportDto['status']): string {
  return status === 'COMPLETED' ? 'success' : status === 'FAILED' ? 'danger' : 'medium'
}

async function confirmDelete(record: CsvImportDto) {
  const alert = await alertController.create({
    header: t('imports.deleteTitle', { label: record.sourceLabel }),
    message: t('imports.deleteMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.delete'),
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
  loadData()
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
