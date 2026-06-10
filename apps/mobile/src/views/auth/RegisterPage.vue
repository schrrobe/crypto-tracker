<template>
  <ion-page>
    <ion-content :fullscreen="true" class="ion-padding">
      <div class="auth-wrap">
        <h1>Crypto Tracker</h1>
        <p class="subtitle">Konto erstellen</p>

        <form @submit.prevent="submit">
          <ion-list inset>
            <ion-item>
              <ion-input
                v-model="email"
                label="E-Mail"
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
                label="Passwort (min. 10 Zeichen)"
                label-placement="floating"
                type="password"
                autocomplete="new-password"
                required
                data-testid="register-password"
              />
            </ion-item>
          </ion-list>

          <ion-text v-if="error" color="danger">
            <p class="error" data-testid="register-error">{{ error }}</p>
          </ion-text>

          <ion-button expand="block" type="submit" :disabled="loading" data-testid="register-submit">
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>Registrieren</span>
          </ion-button>
        </form>

        <ion-button expand="block" fill="clear" router-link="/login" data-testid="goto-login">
          Schon ein Konto? Anmelden
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

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (password.value.length < 10) {
    error.value = 'Das Passwort muss mindestens 10 Zeichen haben'
    return
  }
  loading.value = true
  try {
    await auth.register(email.value, password.value)
    router.replace('/tabs/dashboard')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Registrierung fehlgeschlagen'
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
