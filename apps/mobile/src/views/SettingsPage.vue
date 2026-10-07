<template>
  <ion-page>
    <AppTopBar
      :title="$t('ui.settings.title')"
      back-href="/tabs/dashboard"
      :show-switcher="false"
      :show-privacy="false"
      :show-profile="false"
    />
    <ion-content>
      <div class="page">
        <!-- Who is signed in, and on which plan -->
        <section class="account sheet" aria-labelledby="account-title">
          <span class="avatar" aria-hidden="true">{{ (auth.user?.email?.[0] ?? '·').toUpperCase() }}</span>
          <div class="account-text">
            <h2 id="account-title" class="sr-only">{{ $t('ui.settings.account') }}</h2>
            <p class="email" data-testid="settings-email">{{ auth.user?.email }}</p>
            <p class="plan">
              {{ $t('paywall.planLabel') }}:
              <span class="tag" :class="{ 'tag--pro': auth.isPro }" data-testid="settings-plan">
                {{ auth.isPro ? $t('paywall.planPro') : $t('paywall.planFree') }}
              </span>
            </p>
          </div>
          <ion-button v-if="!auth.isPro" size="small" data-testid="settings-upgrade" @click="openPaywall()">
            {{ $t('paywall.upgrade') }}
          </ion-button>
          <ion-button v-else size="small" fill="outline" data-testid="settings-manage-plan" @click="managePlan">
            {{ $t('paywall.manage') }}
          </ion-button>
        </section>

        <!-- Sync -->
        <section class="section" aria-labelledby="plan-title">
          <h2 id="plan-title" class="section-title group-title">{{ $t('ui.settings.plan') }}</h2>
          <ion-list inset class="group">
            <!-- Free: the whole row opens the paywall; the toggle only exists for Pro -->
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
                :aria-label="$t('settings.autoSync')"
                data-testid="auto-sync-toggle"
                @ionChange="onAutoSync($event.detail.checked)"
              />
              <span v-else slot="end" class="tag" data-testid="auto-sync-lock">
                <ion-icon :icon="lockClosedOutline" aria-hidden="true" /> Pro
              </span>
            </ion-item>
            <!-- Dev toggle (local only): the server also enforces APP_ENV===local -->
            <ion-item v-if="isDev" class="dev-only" lines="none">
              <ion-label color="warning">DEV ONLY · Plan</ion-label>
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
          <p v-if="autoSyncError" class="notice notice--error inline-error" role="alert" data-testid="auto-sync-error">
            {{ autoSyncError }}
          </p>
        </section>

        <!-- Appearance -->
        <section class="section" aria-labelledby="appearance-title">
          <h2 id="appearance-title" class="section-title group-title">{{ $t('ui.settings.appearance') }}</h2>
          <ion-list inset class="group">
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
        </section>

        <!-- Data & taxes -->
        <section class="section" aria-labelledby="data-title">
          <h2 id="data-title" class="section-title group-title">{{ $t('ui.settings.data') }}</h2>
          <ion-list inset class="group">
            <ion-item button data-testid="open-tax-report" @click="openTaxReport">
              <ion-icon slot="start" :icon="documentTextOutline" aria-hidden="true" />
              <ion-label>{{ $t('tax.settingsEntry') }}</ion-label>
              <span v-if="!auth.isPro" slot="end" class="tag">
                <ion-icon :icon="lockClosedOutline" aria-hidden="true" /> Pro
              </span>
            </ion-item>
            <ion-item button data-testid="open-referral" @click="openReferral">
              <ion-icon slot="start" :icon="giftOutline" aria-hidden="true" />
              <ion-label>{{ $t('referral.settingsEntry') }}</ion-label>
            </ion-item>
          </ion-list>
        </section>

        <!-- Tax entities: separate portfolios (own, parents, …) -->
        <section class="section" aria-labelledby="entities-title">
          <h2 id="entities-title" class="section-title group-title">{{ $t('portfolios.title') }}</h2>
          <ion-list inset class="group">
            <ion-item v-for="p in portfolios.portfolios" :key="p.id" :data-testid="`portfolio-${p.label}`">
              <ion-label>
                <h3>
                  {{ p.label }}
                  <span v-if="p.isDefault" class="tag">{{ $t('portfolios.default') }}</span>
                </h3>
                <p>{{ $t('portfolios.sourceCount', { n: p.sourceCount }) }}</p>
              </ion-label>
              <ion-buttons slot="end">
                <ion-button
                  :aria-label="`${$t('ui.sources.rename')}: ${p.label}`"
                  :data-testid="`portfolio-rename-${p.label}`"
                  @click="promptRenamePortfolio(p)"
                >
                  <ion-icon :icon="createOutline" slot="icon-only" aria-hidden="true" />
                </ion-button>
                <ion-button
                  color="danger"
                  :aria-label="`${$t('common.delete')}: ${p.label}`"
                  :data-testid="`portfolio-delete-${p.label}`"
                  @click="deletePortfolio(p)"
                >
                  <ion-icon :icon="trashOutline" slot="icon-only" aria-hidden="true" />
                </ion-button>
              </ion-buttons>
            </ion-item>
            <ion-item button :detail="false" data-testid="portfolio-create" @click="onCreatePortfolio">
              <ion-icon slot="start" :icon="addOutline" color="primary" aria-hidden="true" />
              <ion-label color="primary">{{ $t('portfolios.create') }}</ion-label>
              <ion-note v-if="!auth.isPro" slot="end" class="fig" data-testid="portfolio-count">
                {{ portfolios.portfolios.length }}/{{ FREE_LIMITS.portfolios }}
              </ion-note>
              <ion-icon v-if="portfolioAtLimit" :icon="lockClosedOutline" slot="end" aria-hidden="true" />
            </ion-item>
          </ion-list>
          <p v-if="portfolioError" class="notice notice--error inline-error" role="alert" data-testid="portfolio-error">
            {{ portfolioError }}
          </p>
        </section>

        <!-- Session and account -->
        <section class="section" aria-labelledby="session-title">
          <h2 id="session-title" class="section-title group-title">{{ $t('ui.settings.account') }}</h2>
          <ion-list inset class="group">
            <ion-item button :detail="false" data-testid="logout-button" @click="logout">
              <ion-icon slot="start" :icon="logOutOutline" aria-hidden="true" />
              <ion-label>{{ $t('settings.logout') }}</ion-label>
            </ion-item>
            <ion-item button :detail="false" data-testid="delete-account-button" @click="confirmDeleteAccount">
              <ion-icon slot="start" :icon="trashOutline" color="danger" aria-hidden="true" />
              <ion-label color="danger">{{ $t('settings.deleteAccount') }}</ion-label>
            </ion-item>
          </ion-list>
        </section>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonButton,
  IonButtons,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonToggle,
  onIonViewWillEnter,
} from '@ionic/vue'
import AppTopBar from '../components/AppTopBar.vue'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  addOutline,
  createOutline,
  documentTextOutline,
  giftOutline,
  lockClosedOutline,
  logOutOutline,
  trashOutline,
} from 'ionicons/icons'
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

<style scoped>
.account {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--app-space-3);
  padding: var(--app-space-4);
}
.avatar {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 50%;
  background: var(--app-ink);
  color: var(--app-ground);
  font-weight: 700;
  font-size: var(--app-text-lg);
}
.account-text {
  flex: 1 1 12rem;
  min-width: 0;
}
.account ion-button {
  margin-left: auto;
}
.email {
  margin: 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.plan {
  margin: 2px 0 0;
  font-size: var(--app-text-sm);
  color: var(--app-ink-2);
}
.tag--pro {
  border-color: var(--app-accent);
  color: var(--app-accent);
}
.group-title {
  margin: 0 0 var(--app-space-2);
}
.group {
  margin: 0;
  border: 1px solid var(--app-rule);
  border-radius: var(--app-radius);
  --ion-item-background: var(--app-sheet);
}
.tag ion-icon {
  vertical-align: -1px;
}
.inline-error {
  margin-top: var(--app-space-3);
}
.dev-only ion-segment {
  max-width: 180px;
}
</style>
