<template>
  <ion-page>
    <ion-content>
      <AuthLayout :title="$t('auth.resetSubtitle')">
        <template v-if="!done">
          <p v-if="!token" class="notice notice--error" role="alert" data-testid="reset-no-token">{{ $t('auth.resetTokenMissing') }}</p>

          <form v-else @submit.prevent="submit">
            <ion-list inset class="auth-fields">
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

            <p v-if="error" class="notice notice--error" role="alert" data-testid="reset-error">{{ error }}</p>

            <ion-button expand="block" type="submit" :disabled="loading" data-testid="reset-submit">
              <ion-spinner v-if="loading" name="crescent" />
              <span v-else>{{ $t('auth.setNewPassword') }}</span>
            </ion-button>
          </form>
        </template>

        <p v-else class="notice notice--info" role="status" data-testid="reset-done">{{ $t('auth.resetSuccess') }}</p>

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
