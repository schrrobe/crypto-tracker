<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ $t('tabs.settings') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-list inset>
        <ion-item>
          <ion-select
            :label="$t('settings.appearance')"
            interface="popover"
            :value="theme"
            @ionChange="onThemeChange($event.detail.value)"
          >
            <ion-select-option value="system">{{ $t('settings.system') }}</ion-select-option>
            <ion-select-option value="light">{{ $t('settings.light') }}</ion-select-option>
            <ion-select-option value="dark">{{ $t('settings.dark') }}</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select
            :label="$t('settings.baseCurrency')"
            interface="popover"
            :value="auth.user?.baseCurrency ?? 'EUR'"
            data-testid="currency-select"
            @ionChange="onCurrencyChange($event.detail.value)"
          >
            <ion-select-option value="EUR">EUR</ion-select-option>
            <ion-select-option value="USD">USD</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select
            :label="$t('settings.language')"
            interface="popover"
            :value="locale"
            data-testid="language-select"
            @ionChange="onLocaleChange($event.detail.value)"
          >
            <ion-select-option v-for="l in SUPPORTED_LOCALES" :key="l.code" :value="l.code">
              {{ l.name }}
            </ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>

      <ion-list inset>
        <ion-item button data-testid="open-tax-report" @click="router.push('/tabs/settings/tax-report')">
          <ion-label>{{ $t('tax.settingsEntry') }}</ion-label>
        </ion-item>
      </ion-list>

      <ion-list inset>
        <ion-item>
          <ion-label>
            <p>{{ $t('settings.signedInAs') }}</p>
            <h3 data-testid="settings-email">{{ auth.user?.email }}</h3>
          </ion-label>
        </ion-item>
        <ion-item button :detail="false" data-testid="logout-button" @click="logout">
          <ion-label color="danger">{{ $t('settings.logout') }}</ion-label>
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
import { getLocale, setLocale, SUPPORTED_LOCALES, type LocaleCode } from '../i18n'
import { useAuthStore } from '../stores/auth.store'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'

const auth = useAuthStore()
const portfolio = usePortfolioStore()
const sources = useSourcesStore()
const router = useRouter()
const theme = ref<ThemePreference>(getThemePreference())
const locale = ref<LocaleCode>(getLocale())

function onThemeChange(value: ThemePreference) {
  theme.value = value
  setThemePreference(value)
}

function onLocaleChange(value: LocaleCode) {
  locale.value = value
  setLocale(value)
}

async function onCurrencyChange(value: 'EUR' | 'USD') {
  if (value !== auth.user?.baseCurrency) await auth.updateBaseCurrency(value)
}

async function logout() {
  await auth.logout()
  portfolio.reset()
  sources.reset()
  router.replace('/login')
}
</script>
