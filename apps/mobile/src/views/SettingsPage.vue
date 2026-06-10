<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Einstellungen</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-list inset>
        <ion-item>
          <ion-select
            label="Erscheinungsbild"
            interface="popover"
            :value="theme"
            @ionChange="onThemeChange($event.detail.value)"
          >
            <ion-select-option value="system">System</ion-select-option>
            <ion-select-option value="light">Hell</ion-select-option>
            <ion-select-option value="dark">Dunkel</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>

      <ion-list inset>
        <ion-item>
          <ion-label>
            <p>Angemeldet als</p>
            <h3 data-testid="settings-email">{{ auth.user?.email }}</h3>
          </ion-label>
        </ion-item>
        <ion-item button :detail="false" data-testid="logout-button" @click="logout">
          <ion-label color="danger">Abmelden</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../services/theme.service'
import { useAuthStore } from '../stores/auth.store'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'

const auth = useAuthStore()
const portfolio = usePortfolioStore()
const sources = useSourcesStore()
const router = useRouter()
const theme = ref<ThemePreference>(getThemePreference())

function onThemeChange(value: ThemePreference) {
  theme.value = value
  setThemePreference(value)
}

async function logout() {
  await auth.logout()
  portfolio.reset()
  sources.reset()
  router.replace('/login')
}
</script>
