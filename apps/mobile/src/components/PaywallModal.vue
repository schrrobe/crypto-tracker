<template>
  <ion-modal :is-open="paywallOpen" @didDismiss="closePaywall" @willPresent="onPresent">
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('paywall.title') }}</ion-title>
        <ion-buttons slot="end">
          <ion-button data-testid="paywall-close" @click="closePaywall">{{ $t('common.close') }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <p class="intro" data-testid="paywall-subtitle">{{ subtitle }}</p>
      <ion-list inset>
        <ion-item v-for="f in orderedFeatures" :key="f" :class="{ hit: f === paywallFeature }">
          <ion-icon :icon="checkmarkCircle" color="success" slot="start" />
          <ion-label class="ion-text-wrap">{{ $t(`paywall.feature.${f}`) }}</ion-label>
        </ion-item>
      </ion-list>

      <ion-text v-if="error" color="danger"><p class="error">{{ error }}</p></ion-text>

      <template v-if="billing.enabled">
        <p v-if="billing.priceLabel" class="price" data-testid="paywall-price">{{ billing.priceLabel }}</p>
        <ion-button
          expand="block"
          :disabled="loading"
          data-testid="paywall-upgrade"
          @click="upgrade"
        >
          <ion-spinner v-if="loading" name="crescent" />
          <span v-else>{{ $t('paywall.upgrade') }}</span>
        </ion-button>
        <ion-button expand="block" fill="clear" data-testid="paywall-later" @click="closePaywall">
          {{ $t('paywall.maybeLater') }}
        </ion-button>
        <p class="hint">{{ $t('paywall.webHint') }}</p>
      </template>
      <p v-else class="hint" data-testid="paywall-unavailable">{{ $t('paywall.unavailable') }}</p>
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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PRO_FEATURES, type ProFeature } from '@crypto-tracker/shared'
import { paywallOpen, paywallFeature, closePaywall } from '../services/paywall'
import { useBillingStore } from '../stores/billing.store'
import { apiErrorMessage } from '../services/errors'

const billing = useBillingStore()
const { t, te } = useI18n()
const loading = ref(false)
const error = ref('')

// The feature the user just hit leads the list (and is highlighted).
const orderedFeatures = computed<readonly ProFeature[]>(() => {
  const f = paywallFeature.value
  if (!f) return PRO_FEATURES
  return [f, ...PRO_FEATURES.filter((x) => x !== f)]
})

// Contextual subtitle for the feature that triggered the paywall; generic intro otherwise.
const subtitle = computed(() => {
  const f = paywallFeature.value
  const key = f ? `paywall.context.${f}` : 'paywall.intro'
  return te(key) ? t(key) : t('paywall.intro')
})

function onPresent() {
  error.value = ''
  billing.loadConfig()
}

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
.price {
  text-align: center;
  font-weight: 600;
  margin: 4px 0 8px;
}
.error {
  margin: 8px 0;
  font-size: 0.9em;
}
/* The feature the user just hit — drawn forward so the paywall answers "why am I here?" */
.hit {
  --background: var(--ion-color-success-tint, rgba(45, 211, 111, 0.12));
  font-weight: 600;
}
</style>
