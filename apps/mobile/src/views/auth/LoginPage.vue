<template>
  <ion-page>
    <ion-content>
      <AuthLayout :title="$t('auth.loginSubtitle')">
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
                data-testid="login-email"
              />
            </ion-item>
            <ion-item>
              <ion-input
                v-model="password"
                :label="$t('auth.password')"
                label-placement="floating"
                type="password"
                autocomplete="current-password"
                required
                data-testid="login-password"
              />
            </ion-item>
          </ion-list>

          <p v-if="error" class="notice notice--error" role="alert" data-testid="login-error">{{ error }}</p>

          <ion-button expand="block" type="submit" :disabled="loading" data-testid="login-submit">
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>{{ $t('auth.login') }}</span>
          </ion-button>
        </form>

        <nav class="auth-links">
          <router-link to="/forgot-password" data-testid="goto-forgot">{{ $t('auth.forgotPassword') }}</router-link>
          <router-link to="/register" data-testid="goto-register">{{ $t('auth.noAccount') }}</router-link>
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
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth.store'
import { ApiError } from '../../services/api.client'
import { t } from '../../i18n'

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.replace('/tabs/dashboard')
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 401
        ? t('auth.invalidCredentials')
        : t('auth.loginFailed')
  } finally {
    loading.value = false
  }
}
</script>
