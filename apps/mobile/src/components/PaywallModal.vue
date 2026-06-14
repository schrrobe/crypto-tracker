<template>
  <ion-modal :is-open="paywallOpen" @didDismiss="closePaywall">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('paywall.title') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="paywall-close" @click="closePaywall">{{ $t('common.close') }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p class="intro">{{ $t('paywall.intro') }}</p>
      <ion-list inset>
        <ion-item v-for="f in features" :key="f">
          <ion-icon :icon="checkmarkCircle" color="success" slot="start" />
          <ion-label class="ion-text-wrap">{{ $t(`paywall.feature.${f}`) }}</ion-label>
        </ion-item>
      </ion-list>
      <ion-text v-if="error" color="danger"><p class="error">{{ error }}</p></ion-text>
      <ion-button
        expand="block"
        :disabled="loading"
        data-testid="paywall-upgrade"
        @click="upgrade"
      >
        <ion-spinner v-if="loading" name="crescent" />
        <span v-else>{{ $t('paywall.upgrade') }}</span>
      </ion-button>
      <p class="hint">{{ $t('paywall.webHint') }}</p>
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { checkmarkCircle } from 'ionicons/icons'
import { ref } from 'vue'
import { PRO_FEATURES } from '@crypto-tracker/shared'
import { paywallOpen, closePaywall } from '../services/paywall'
import { useBillingStore } from '../stores/billing.store'
import { apiErrorMessage } from '../services/errors'

const billing = useBillingStore()
const features = PRO_FEATURES
const loading = ref(false)
const error = ref('')

async function upgrade() {
  error.value = ''
  loading.value = true
  try {
    await billing.checkout()
  } catch (e) {
    error.value = apiErrorMessage(e, 'paywall.upgradeFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.intro,
.hint {
  color: var(--ion-color-medium);
  font-size: 0.9em;
}
.hint {
  text-align: center;
  margin-top: 12px;
}
.error {
  margin: 8px 0;
  font-size: 0.9em;
}
</style>
