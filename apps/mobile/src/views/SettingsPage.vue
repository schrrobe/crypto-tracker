<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <PortfolioSwitcher @switched="portfolios.load" />
        </ion-buttons>
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
        <ion-item button data-testid="open-tax-report" @click="openTaxReport">
          <ion-label>{{ $t('tax.settingsEntry') }}</ion-label>
          <ion-icon v-if="!auth.isPro" :icon="lockClosedOutline" slot="end" color="medium" />
          <ion-badge v-else slot="end" color="success">Pro</ion-badge>
        </ion-item>
      </ion-list>

      <!-- Abo / Plan -->
      <ion-list inset>
        <ion-item>
          <ion-label>
            <p>{{ $t('paywall.planLabel') }}</p>
            <h3 data-testid="settings-plan">{{ auth.isPro ? 'Pro' : 'Free' }}</h3>
          </ion-label>
          <ion-button
            v-if="!auth.isPro"
            slot="end"
            data-testid="settings-upgrade"
            @click="openPaywall"
          >
            {{ $t('paywall.upgrade') }}
          </ion-button>
          <ion-button
            v-else
            slot="end"
            fill="outline"
            data-testid="settings-manage-plan"
            @click="managePlan"
          >
            {{ $t('paywall.manage') }}
          </ion-button>
        </ion-item>
        <!-- Dev-Schalter (nur lokal) zum Testen des Gatings ohne Stripe -->
        <ion-item v-if="isDev">
          <ion-label color="medium">Dev: Plan</ion-label>
          <ion-segment
            slot="end"
            :value="auth.isPro ? 'PRO' : 'FREE'"
            data-testid="dev-plan-toggle"
            @ionChange="onDevPlan($event.detail.value as 'FREE' | 'PRO')"
          >
            <ion-segment-button value="FREE"><ion-label>Free</ion-label></ion-segment-button>
            <ion-segment-button value="PRO"><ion-label>Pro</ion-label></ion-segment-button>
          </ion-segment>
        </ion-item>
      </ion-list>

      <!-- Portfolio-Verwaltung: getrennte Steuersubjekte (eigenes, Eltern, …) -->
      <ion-list inset>
        <ion-list-header>
          <ion-label>{{ $t('portfolios.title') }}</ion-label>
        </ion-list-header>
        <ion-item v-for="p in portfolios.portfolios" :key="p.id" :data-testid="`portfolio-${p.label}`">
          <ion-label>
            <h3>
              {{ p.label }}
              <ion-badge v-if="p.isDefault" color="medium">{{ $t('portfolios.default') }}</ion-badge>
            </h3>
            <p>{{ $t('portfolios.sourceCount', { n: p.sourceCount }) }}</p>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button :data-testid="`portfolio-rename-${p.label}`" @click="promptRenamePortfolio(p)">
              <ion-icon :icon="createOutline" slot="icon-only" />
            </ion-button>
            <ion-button
              color="danger"
              :data-testid="`portfolio-delete-${p.label}`"
              @click="deletePortfolio(p)"
            >
              <ion-icon :icon="trashOutline" slot="icon-only" />
            </ion-button>
          </ion-buttons>
        </ion-item>
        <ion-item button :detail="false" data-testid="portfolio-create" @click="promptCreatePortfolio">
          <ion-label color="primary">{{ $t('portfolios.create') }}</ion-label>
        </ion-item>
      </ion-list>
      <ion-text v-if="portfolioError" color="danger">
        <p class="portfolio-error" data-testid="portfolio-error">{{ portfolioError }}</p>
      </ion-text>

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
        <ion-item button :detail="false" data-testid="delete-account-button" @click="confirmDeleteAccount">
          <ion-label color="danger">{{ $t('settings.deleteAccount') }}</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import PortfolioSwitcher from '../components/PortfolioSwitcher.vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { createOutline, lockClosedOutline, trashOutline } from 'ionicons/icons'
import type { PortfolioDto } from '@crypto-tracker/shared'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../services/theme.service'
import { apiErrorMessage } from '../services/errors'
import { openPaywall } from '../services/paywall'
import { usePortfoliosStore } from '../stores/portfolios.store'
import { useBillingStore } from '../stores/billing.store'
import { getLocale, setLocale, SUPPORTED_LOCALES, t, type LocaleCode } from '../i18n'
import { useAuthStore } from '../stores/auth.store'
import { usePortfolioStore } from '../stores/portfolio.store'
import { useSourcesStore } from '../stores/sources.store'

const auth = useAuthStore()
const billing = useBillingStore()
const portfolios = usePortfoliosStore()
const portfolioError = ref('')
const portfolio = usePortfolioStore()
const isDev = import.meta.env.DEV

function openTaxReport() {
  if (auth.isPro) router.push('/tabs/settings/tax-report')
  else openPaywall()
}

async function managePlan() {
  await billing.openPortal().catch((e) => (portfolioError.value = apiErrorMessage(e, 'common.loadFailed')))
}

async function onDevPlan(plan: 'FREE' | 'PRO') {
  await auth.setDevPlan(plan).catch(() => {})
}
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
  portfolios.reset()
  router.replace('/login')
}

async function confirmDeleteAccount() {
  const alert = await alertController.create({
    header: t('settings.deleteAccountTitle'),
    message: t('settings.deleteAccountMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('settings.deleteAccount'),
        role: 'destructive',
        handler: () => {
          auth
            .deleteAccount()
            .then(() => {
              portfolio.reset()
              sources.reset()
              portfolios.reset()
              router.replace('/login')
            })
            .catch((e) => (portfolioError.value = apiErrorMessage(e, 'common.loadFailed')))
        },
      },
    ],
  })
  await alert.present()
}

async function promptCreatePortfolio() {
  const alert = await alertController.create({
    header: t('portfolios.createTitle'),
    inputs: [{ name: 'label', type: 'text', attributes: { maxlength: 60 } }],
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.save'),
        handler: (values: { label: string }) => {
          const label = values.label.trim()
          if (label) portfolios.create(label).catch((e) => (portfolioError.value = apiErrorMessage(e, 'common.loadFailed')))
        },
      },
    ],
  })
  await alert.present()
}

async function promptRenamePortfolio(p: PortfolioDto) {
  const alert = await alertController.create({
    header: t('portfolios.renameTitle'),
    inputs: [{ name: 'label', type: 'text', value: p.label, attributes: { maxlength: 60 } }],
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.save'),
        handler: (values: { label: string }) => {
          const label = values.label.trim()
          if (label && label !== p.label) {
            portfolios.rename(p.id, label).catch((e) => (portfolioError.value = apiErrorMessage(e, 'common.loadFailed')))
          }
        },
      },
    ],
  })
  await alert.present()
}

async function deletePortfolio(p: PortfolioDto) {
  portfolioError.value = ''
  const alert = await alertController.create({
    header: t('portfolios.deleteTitle', { label: p.label }),
    message: t('portfolios.deleteMessage'),
    buttons: [
      { text: t('common.cancel'), role: 'cancel' },
      {
        text: t('common.delete'),
        role: 'destructive',
        handler: () => {
          portfolios.remove(p.id).catch((e) => (portfolioError.value = apiErrorMessage(e, 'common.loadFailed')))
        },
      },
    ],
  })
  await alert.present()
}
</script>
