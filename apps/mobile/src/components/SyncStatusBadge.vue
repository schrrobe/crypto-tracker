<template>
  <span v-if="syncing" class="mark mark--busy" role="status" :data-testid="`sync-status-${source.id}`">
    {{ $t('ui.syncState.busy') }}
  </span>
  <span v-else-if="!syncable" class="mark" :data-testid="`sync-status-${source.id}`">
    {{ source.type === 'MANUAL' ? $t('ui.syncState.manual') : $t('ui.syncState.imported') }}
  </span>
  <span v-else-if="!source.lastSyncRun" class="mark mark--warn" :data-testid="`sync-status-${source.id}`">
    {{ $t('ui.syncState.never') }}
  </span>
  <!-- Error: a real button so the full provider message is reachable by touch and keyboard -->
  <button
    v-else-if="source.lastSyncRun.status === 'ERROR' && interactive"
    type="button"
    class="mark mark--error mark-button"
    :data-testid="`sync-status-${source.id}`"
    @click.stop.prevent="showError"
  >
    <span class="err-text">{{ errorText }}</span>
    <ion-icon :icon="informationCircleOutline" aria-hidden="true" />
  </button>
  <span v-else-if="source.lastSyncRun.status === 'ERROR'" class="mark mark--error" :data-testid="`sync-status-${source.id}`">
    <span class="err-text">{{ errorText }}</span>
  </span>
  <span
    v-else-if="source.lastSyncRun.errorCode === 'PARTIAL_SYNC'"
    class="mark mark--warn"
    :title="source.lastSyncRun.errorMessage ?? undefined"
    :data-testid="`sync-status-${source.id}`"
  >
    {{ $t('ui.syncState.partial') }}
  </span>
  <span v-else class="mark mark--ok" :data-testid="`sync-status-${source.id}`">
    {{ $t('ui.syncState.ok', { time: formatRelativeTime(source.lastSyncAt) }) }}
  </span>
</template>

<script setup lang="ts">
import { alertController, IonIcon } from '@ionic/vue'
import { informationCircleOutline } from 'ionicons/icons'
import { computed } from 'vue'
import type { SourceDto } from '@crypto-tracker/shared'
import { formatRelativeTime } from '../services/format'
import { t } from '../i18n'

// interactive=false inside rows that are themselves buttons (no nested controls)
const props = withDefaults(defineProps<{ source: SourceDto; syncing: boolean; interactive?: boolean }>(), {
  interactive: true,
})

// Name the problem: the provider's message, not a generic failure
const errorText = computed(() => {
  const message = props.source.lastSyncRun?.errorMessage
  return message ? t('sync.error', { message }) : t('ui.syncState.error')
})

const syncable = computed(() => props.source.type === 'EXCHANGE' || props.source.type === 'WALLET')

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
.mark-button {
  background: none;
  border: 0;
  padding: 0;
  min-height: 24px;
  font: inherit;
  font-size: var(--app-text-xs);
  font-weight: 600;
  cursor: pointer;
}
.mark-button .err-text {
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
.err-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: left;
}
.mark-button ion-icon {
  font-size: 0.875rem;
}
</style>
