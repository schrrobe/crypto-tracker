<template>
  <!-- Force-update gate: not dismissable (no backdrop dismiss, no close button,
       Escape/back swallowed) so an outdated client cannot use the app. -->
  <ion-modal
    :is-open="updateRequired"
    :backdrop-dismiss="false"
    :can-dismiss="false"
    data-testid="update-gate"
  >
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('update.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="gate">
        <ion-icon :icon="cloudDownloadOutline" color="primary" class="icon" />
        <p class="message">{{ $t('update.message') }}</p>
        <ion-button
          v-if="storeUrl"
          expand="block"
          data-testid="update-gate-button"
          @click="openExternal(storeUrl)"
        >
          {{ $t('update.button') }}
        </ion-button>
      </div>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { cloudDownloadOutline } from 'ionicons/icons'
import { updateRequired, storeUrl } from '../services/app-update'
import { openExternal } from '../services/external-link'
</script>

<style scoped>
.gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding-top: 24px;
}
.icon {
  font-size: 64px;
}
.message {
  color: var(--ion-color-medium);
}
</style>
