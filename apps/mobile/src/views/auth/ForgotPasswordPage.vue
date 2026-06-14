<template>
  <ion-page>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="auth-wrap">
        <h1>{{ $t('auth.appTitle') }}</h1>
        <p class="subtitle">{{ $t('auth.forgotSubtitle') }}</p>

        <template v-if="!sent">
          <form @submit.prevent="submit">
            <ion-list inset>
              <ion-item>
                <ion-input
                  v-model="email"
                  :label="$t('auth.email')"
                  label-placement="floating"
                  type="email"
                  autocomplete="email"
                  required
                  data-testid="forgot-email"
                />
              </ion-item>
            </ion-list>

            <ion-text v-if="error" color="danger">
              <p class="error" data-testid="forgot-error">{{ error }}</p>
            </ion-text>

            <ion-button expand="block" type="submit" :disabled="loading" data-testid="forgot-submit">
              <ion-spinner v-if="loading" name="crescent" />
              <span v-else>{{ $t('auth.sendResetLink') }}</span>
            </ion-button>
          </form>
        </template>

        <ion-text v-else color="medium">
          <p class="info" data-testid="forgot-sent">{{ $t('auth.resetLinkSent') }}</p>
        </ion-text>

        <ion-button expand="block" fill="clear" router-link="/login" data-testid="goto-login">
          {{ $t('auth.backToLogin') }}
        </ion-button>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonList,
  IonPage,
  IonSpinner,
  IonText,
} from '@ionic/vue'
import { ref } from 'vue'
import { useAuthStore } from '../../stores/auth.store'
import { apiErrorMessage } from '../../services/errors'

const auth = useAuthStore()

const email = ref('')
const error = ref('')
const loading = ref(false)
const sent = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.forgotPassword(email.value)
    // the response is deliberately neutral — show the confirmation regardless of whether the address exists
    sent.value = true
  } catch (e) {
    error.value = apiErrorMessage(e, 'auth.resetRequestFailed')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-wrap {
  max-width: 420px;
  margin: 12vh auto 0;
}
h1 {
  text-align: center;
  font-weight: 700;
}
.subtitle {
  text-align: center;
  color: var(--ion-color-medium);
  margin-bottom: 24px;
}
.error,
.info {
  margin: 8px 16px;
  font-size: 0.9em;
}
.info {
  text-align: center;
}
</style>
