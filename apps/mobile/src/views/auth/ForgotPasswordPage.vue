<template>
  <ion-page>
    <ion-content>
      <AuthLayout :title="$t('auth.forgotSubtitle')">
        <template v-if="!sent">
          <form @submit.prevent="submit">
            <ion-list inset class="auth-fields">
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

            <p v-if="error" class="notice notice--error" role="alert" data-testid="forgot-error">{{ error }}</p>

            <ion-button expand="block" type="submit" :disabled="loading" data-testid="forgot-submit">
              <ion-spinner v-if="loading" name="crescent" />
              <span v-else>{{ $t('auth.sendResetLink') }}</span>
            </ion-button>
          </form>
        </template>

        <p v-else class="notice notice--info" role="status" data-testid="forgot-sent">{{ $t('auth.resetLinkSent') }}</p>

        <nav class="auth-links">
          <router-link to="/login" data-testid="goto-login">{{ $t('auth.backToLogin') }}</router-link>
        </nav>
      </AuthLayout>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import AuthLayout from '../../components/AuthLayout.vue'
import {
  IonButton,
  IonContent,
  IonInput,
  IonItem,
  IonList,
  IonPage,
  IonSpinner,
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
