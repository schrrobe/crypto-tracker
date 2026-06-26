<template>
  <ion-badge v-if="syncing" color="medium" :data-testid="`sync-status-${source.id}`">
    <ion-spinner name="crescent" class="spinner" /> {{ $t('sync.running') }}
  </ion-badge>
  <ion-badge
    v-else-if="!syncable"
    color="light"
    :data-testid="`sync-status-${source.id}`"
  >
    {{ source.type === 'MANUAL' ? $t('sync.manual') : $t('sync.csv') }}
  </ion-badge>
  <ion-badge
    v-else-if="!source.lastSyncRun"
    color="medium"
    :data-testid="`sync-status-${source.id}`"
  >
    {{ $t('sync.never') }}
  </ion-badge>
  <ion-badge
    v-else-if="source.lastSyncRun.status === 'ERROR'"
    color="danger"
    class="tappable"
    role="button"
    tabindex="0"
    :title="source.lastSyncRun.errorMessage ?? undefined"
    :data-testid="`sync-status-${source.id}`"
    @click="showError"
    @keydown.enter.prevent="showError"
    @keydown.space.prevent="showError"
  >
    {{ $t('sync.error', { message: source.lastSyncRun.errorMessage }) }}
  </ion-badge>
  <ion-badge v-else color="success" :data-testid="`sync-status-${source.id}`">
    {{ formatRelativeTime(source.lastSyncAt) }}
  </ion-badge>
</template>

<script setup lang="ts">
import { alertController, IonBadge, IonSpinner } from '@ionic/vue'
import { computed } from 'vue'
import type { SourceDto } from '@crypto-tracker/shared'
import { formatRelativeTime } from '../services/format'
import { t } from '../i18n'

const props = defineProps<{ source: SourceDto; syncing: boolean }>()

const syncable = computed(() => props.source.type === 'EXCHANGE' || props.source.type === 'WALLET')

// The badge truncates the error; tapping shows the full message (no hover on touch).
async function showError() {
  const message = props.source.lastSyncRun?.errorMessage
  if (!message) return
  const alert = await alertController.create({
    header: t('sync.errorTitle'),
    message,
    buttons: [{ text: t('common.close'), role: 'cancel' }],
  })
  await alert.present()
}
</script>

<style scoped>
.spinner {
  width: 12px;
  height: 12px;
  vertical-align: middle;
}
ion-badge {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tappable {
  cursor: pointer;
}
</style>
