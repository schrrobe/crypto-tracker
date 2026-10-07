<template>
  <ion-page>
    <ion-content>
      <AuthLayout :title="$t('auth.registerSubtitle')">
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
                data-testid="register-email"
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="password"
                :label="$t('auth.passwordWithHint')"
                label-placement="floating"
                type="password"
                autocomplete="new-password"
                required
                data-testid="register-password"
              />
            </ion-item>
          </ion-list>

          <p v-if="error" class="notice notice--error" role="alert" data-testid="register-error">{{ error }}</p>

          <ion-button expand="block" type="submit" :disabled="loading" data-testid="register-submit">
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>{{ $t('auth.register') }}</span>
          </ion-button>
        </form>

        <nav class="auth-links">
          <router-link to="/login" data-testid="goto-login">{{ $t('auth.hasAccount') }}</router-link>
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
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth.store'
import { apiErrorMessage } from '../../services/errors'
import { t } from '../../i18n'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
// Referral code from an invite link (/register?ref=CODE); undefined if absent.
const referralCode = typeof route.query.ref === 'string' ? route.query.ref : undefined

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (password.value.length < 10) {
    error.value = t('auth.passwordTooShort')
    return
  }
  loading.value = true
  try {
    await auth.register(email.value, password.value, referralCode)
    router.replace('/tabs/dashboard')
  } catch (e) {
    error.value = apiErrorMessage(e, 'auth.registerFailed')
  } finally {
    loading.value = false
  }
}
</script>
