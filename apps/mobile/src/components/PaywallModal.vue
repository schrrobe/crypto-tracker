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
          <ion-icon :icon="checkmarkCircle" color="primary" slot="start" aria-hidden="true" />
          <ion-label class="ion-text-wrap">{{ $t(`paywall.feature.${f}`) }}</ion-label>
        </ion-item>
      </ion-list>

      <p v-if="error" class="notice notice--error error" role="alert">{{ error }}</p>

      <ion-spinner v-if="!billing.configLoaded" name="crescent" data-testid="paywall-loading" />
      <template v-else-if="billing.enabled">
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
.intro {
  margin: 0 0 var(--app-space-2);
  font-size: var(--app-text-md);
  color: var(--app-ink);
}
.hint {
  color: var(--app-ink-2);
  font-size: var(--app-text-sm);
  text-align: center;
  margin-top: var(--app-space-3);
}
.price {
  text-align: center;
  font-family: var(--app-font-figures);
  font-stretch: var(--app-figures-stretch);
  font-weight: 600;
  font-size: var(--app-text-lg);
  margin: var(--app-space-5) 0 var(--app-space-3);
}
.error {
  margin: var(--app-space-3) 0;
}
ion-list {
  margin-left: 0;
  margin-right: 0;
}
/* The feature the user just hit — drawn forward so the paywall answers "why am I here?" */
.hit {
  --background: var(--app-accent-soft);
  font-weight: 600;
}
</style>
