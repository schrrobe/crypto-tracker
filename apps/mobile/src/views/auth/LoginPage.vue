<template>
  <ion-page>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="auth-wrap">
        <h1>{{ $t('auth.appTitle') }}</h1>
        <p class="subtitle">{{ $t('auth.loginSubtitle') }}</p>

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

          <ion-text v-if="error" color="danger">
            <p class="error" data-testid="login-error">{{ error }}</p>
          </ion-text>

          <ion-button expand="block" type="submit" :disabled="loading" data-testid="login-submit">
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>{{ $t('auth.login') }}</span>
          </ion-button>
        </form>

        <ion-button expand="block" fill="clear" router-link="/register" data-testid="goto-register">
          {{ $t('auth.noAccount') }}
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
.error {
  margin: 8px 16px;
  font-size: 0.9em;
}
</style>
