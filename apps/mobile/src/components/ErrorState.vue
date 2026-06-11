<template>
  <div class="error-state" data-testid="error-state">
    <p>{{ $t('common.loadFailed') }}</p>
    <ion-button fill="outline" data-testid="error-retry" @click="$emit('retry')">
      {{ $t('common.retry') }}
    </ion-button>
  </div>
</template>

<script setup lang="ts">
import { IonButton } from '@ionic/vue'

defineEmits<{ retry: [] }>()
</script>

<style scoped>
.error-state {
  text-align: center;
  margin-top: 48px;
  color: var(--ion-color-medium);
}
</style>
