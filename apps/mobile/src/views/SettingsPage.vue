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
        <ion-item button data-testid="open-referral" @click="openReferral">
          <ion-label>{{ $t('referral.settingsEntry') }}</ion-label>
          <ion-icon :icon="giftOutline" slot="end" color="medium" />
        </ion-item>
      </ion-list>

      <!-- Subscription / plan -->
      <ion-list inset>
        <ion-item>
          <ion-label>
            <p>{{ $t('paywall.planLabel') }}</p>
            <h3 data-testid="settings-plan">
              <ion-badge :color="auth.isPro ? 'success' : 'medium'">
                {{ auth.isPro ? $t('paywall.planPro') : $t('paywall.planFree') }}
              </ion-badge>
            </h3>
          </ion-label>
          <ion-button
            v-if="!auth.isPro"
            slot="end"
            data-testid="settings-upgrade"
            @click="openPaywall()"
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
        <!-- Automatic sync (Pro) — Free: the whole row opens the paywall, not a
             tiny lock icon; the toggle only exists (and is actionable) for Pro. -->
        <ion-item
          :button="!auth.isPro"
          :detail="false"
          data-testid="auto-sync-row"
          @click="!auth.isPro && openPaywall('autoSync')"
        >
          <ion-label class="ion-text-wrap">
            {{ $t('settings.autoSync') }}
            <p data-testid="auto-sync-helper">{{ $t('settings.autoSyncHelper') }}</p>
          </ion-label>
          <ion-toggle
            v-if="auth.isPro"
            slot="end"
            :checked="auth.user?.autoSyncEnabled ?? false"
            :disabled="autoSyncSaving"
            data-testid="auto-sync-toggle"
            @ionChange="onAutoSync($event.detail.checked)"
          />
          <ion-icon
            v-else
            :icon="lockClosedOutline"
            slot="end"
            color="medium"
            data-testid="auto-sync-lock"
          />
        </ion-item>
        <ion-text v-if="autoSyncError" color="danger">
          <p class="portfolio-error" data-testid="auto-sync-error">{{ autoSyncError }}</p>
        </ion-text>
        <!-- Dev toggle (local only) for testing the gating without Stripe. Server
             also enforces APP_ENV===local, so this is inert in any real build —
             styled as an unmistakable dev-only control regardless. -->
        <ion-item v-if="isDev" class="dev-only" lines="full">
          <ion-label color="warning">⚠ DEV ONLY · Plan</ion-label>
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

      <!-- Portfolio management: separate tax subjects (own, parents, …) -->
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
        <ion-item button :detail="false" data-testid="portfolio-create" @click="onCreatePortfolio">
          <ion-label color="primary">{{ $t('portfolios.create') }}</ion-label>
          <ion-note v-if="!auth.isPro" slot="end" data-testid="portfolio-count">
            {{ portfolios.portfolios.length }}/{{ FREE_LIMITS.portfolios }}
          </ion-note>
          <ion-icon v-if="portfolioAtLimit" :icon="lockClosedOutline" slot="end" color="medium" />
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
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue'
import PortfolioSwitcher from '../components/PortfolioSwitcher.vue'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createOutline, giftOutline, lockClosedOutline, trashOutline } from 'ionicons/icons'
import { FREE_LIMITS, type PortfolioDto } from '@crypto-tracker/shared'
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
  else openPaywall('tax')
}

function openReferral() {
  router.push('/tabs/settings/referral')
}

async function managePlan() {
  await billing.openPortal().catch((e) => (portfolioError.value = apiErrorMessage(e, 'common.loadFailed')))
}

async function onDevPlan(plan: 'FREE' | 'PRO') {
  await auth.setDevPlan(plan).catch(() => {})
}

const autoSyncSaving = ref(false)
const autoSyncError = ref('')
async function onAutoSync(enabled: boolean) {
  if (!auth.isPro) return
  autoSyncError.value = ''
  autoSyncSaving.value = true
  try {
    await auth.setAutoSync(enabled)
  } catch (e) {
    // A failed save used to be swallowed silently, leaving the toggle desynced.
    autoSyncError.value = apiErrorMessage(e, 'settings.autoSyncFailed')
  } finally {
    autoSyncSaving.value = false
  }
}

const portfolioAtLimit = computed(
  () => !auth.isPro && portfolios.portfolios.length >= FREE_LIMITS.portfolios,
)
function onCreatePortfolio() {
  // Pre-empt the server 402: a Free user at the cap goes straight to the paywall
  // instead of being prompted for a name and then rejected.
  if (portfolioAtLimit.value) {
    openPaywall('unlimitedPortfolios')
    return
  }
  promptCreatePortfolio()
}
const sources = useSourcesStore()
const router = useRouter()
const route = useRoute()

// Returning from Stripe Checkout: reconcile the plan immediately instead of
// waiting for the webhook, then drop the query so a refresh doesn't re-run it.
onIonViewWillEnter(async () => {
  if (route.query.upgrade !== 'success') return
  const sessionId = typeof route.query.session_id === 'string' ? route.query.session_id : ''
  try {
    if (sessionId) await billing.reconcile(sessionId)
    await auth.refreshUser()
    // Clear the query ONLY on success — otherwise a transient failure would
    // discard the only session id that can still apply the paid plan.
    router.replace({ path: '/tabs/settings' })
  } catch {
    // Keep ?session_id so the next view-enter retries the reconcile.
  }
})
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
  portfolioError.value = ''
  // Free tier is capped — surface the paywall up front instead of letting the user
  // name a tax entity and only then hit a 402.
  if (!auth.isPro && portfolios.portfolios.length >= FREE_LIMITS.portfolios) {
    openPaywall()
    return
  }
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
