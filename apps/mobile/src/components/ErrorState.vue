<template>
  <div class="notice notice--error error-state" role="alert" data-testid="error-state">
    <ion-icon :icon="cloudOfflineOutline" aria-hidden="true" />
    <div>
      <p>{{ $t('common.loadFailed') }}</p>
      <ion-button size="small" fill="outline" data-testid="error-retry" @click="$emit('retry')">
        {{ $t('common.retry') }}
      </ion-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonButton, IonIcon } from '@ionic/vue'
import { cloudOfflineOutline } from 'ionicons/icons'

defineEmits<{ retry: [] }>()
</script>

<style scoped>
.error-state ion-icon {
  flex: none;
  font-size: 1.25rem;
  color: var(--app-loss);
  margin-top: 2px;
}
.error-state p {
  margin: 0 0 var(--app-space-2);
  font-weight: 600;
}
</style>
