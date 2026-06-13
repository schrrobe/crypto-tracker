<template>
  <ion-page>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="auth-wrap">
        <h1>{{ $t('auth.appTitle') }}</h1>
        <p class="subtitle">{{ $t('auth.resetSubtitle') }}</p>

        <template v-if="!done">
          <ion-text v-if="!token" color="danger">
            <p class="error" data-testid="reset-no-token">{{ $t('auth.resetTokenMissing') }}</p>
          </ion-text>

          <form v-else @submit.prevent="submit">
            <ion-list inset>
              <ion-item>
                <ion-input
                  v-model="password"
                  :label="$t('auth.passwordWithHint')"
                  label-placement="floating"
                  type="password"
                  autocomplete="new-password"
                  required
                  data-testid="reset-password"
                />
              </ion-item>
            </ion-list>

            <ion-text v-if="error" color="danger">
              <p class="error" data-testid="reset-error">{{ error }}</p>
            </ion-text>

            <ion-button expand="block" type="submit" :disabled="loading" data-testid="reset-submit">
              <ion-spinner v-if="loading" name="crescent" />
              <span v-else>{{ $t('auth.setNewPassword') }}</span>
            </ion-button>
          </form>
        </template>

        <ion-text v-else color="medium">
          <p class="info" data-testid="reset-done">{{ $t('auth.resetSuccess') }}</p>
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
import { useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth.store'
import { apiErrorMessage } from '../../services/errors'
import { t } from '../../i18n'

const auth = useAuthStore()
const route = useRoute()

const token = ref(typeof route.query.token === 'string' ? route.query.token : '')
const password = ref('')
const error = ref('')
const loading = ref(false)
const done = ref(false)

async function submit() {
  error.value = ''
  if (password.value.length < 10) {
    error.value = t('auth.passwordTooShort')
    return
  }
  loading.value = true
  try {
    await auth.resetPassword(token.value, password.value)
    done.value = true
  } catch (e) {
    error.value = apiErrorMessage(e, 'auth.resetFailed')
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
