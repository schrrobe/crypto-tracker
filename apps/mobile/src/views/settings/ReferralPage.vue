<template>
  <ion-page>
    <AppTopBar :title="$t('referral.title')" back-href="/tabs/settings" :show-switcher="false" :show-profile="false" />
    <ion-content :fullscreen="true">
      <!-- Value proposition: plain text on the page, not another card -->
      <header v-if="r" class="intro">
        <h2 class="prop">{{ $t('referral.valueProp') }}</h2>
        <p>{{ $t('referral.valuePropNote') }}</p>
      </header>

      <!-- Referral link -->
      <ion-list inset v-if="r">
        <ion-item>
          <ion-label class="ion-text-wrap">
            <p class="hint">{{ $t('referral.linkLabel') }}</p>
            <h3 class="fig link" data-testid="referral-link">{{ r.link }}</h3>
          </ion-label>
        </ion-item>
        <ion-item button data-testid="referral-share" @click="share">
          <ion-icon :icon="shareSocialOutline" slot="start" />
          <ion-label>{{ $t('referral.share') }}</ion-label>
        </ion-item>
        <!-- Earnings: same statement as the link, one sheet -->
        <ion-item v-if="hasPending">
          <ion-label class="ion-text-wrap">
            {{ $t('referral.earningsPending') }}
            <p class="hint">{{ $t('referral.earningsPendingNote') }}</p>
          </ion-label>
          <ion-note slot="end" class="fig" data-testid="referral-pending">{{ earningsText(r.earnings, 'pendingCents') }}</ion-note>
        </ion-item>
        <ion-item>
          <ion-label>{{ $t('referral.earningsOwed') }}</ion-label>
          <ion-note slot="end" class="fig" data-testid="referral-owed">{{ earningsText(r.earnings, 'owedCents') }}</ion-note>
        </ion-item>
        <ion-item v-if="hasPaid">
          <ion-label>{{ $t('referral.earningsPaid') }}</ion-label>
          <ion-note slot="end" class="fig">{{ earningsText(r.earnings, 'paidCents') }}</ion-note>
        </ion-item>
      </ion-list>

      <!-- Invited accounts -->
      <ion-list inset v-if="r">
        <ion-list-header>{{ $t('referral.invited') }} ({{ r.invitedCount }})</ion-list-header>
        <ion-item v-if="r.invited.length === 0" lines="none">
          <ion-label class="hint">{{ $t('referral.invitedEmpty') }}</ion-label>
        </ion-item>
        <ion-item v-for="(inv, i) in r.invited" :key="i">
          <ion-label>{{ inv.emailMasked }}</ion-label>
          <ion-badge v-if="inv.isPro" slot="end" color="success">Pro</ion-badge>
        </ion-item>
      </ion-list>

      <!-- Bank details for payout — gated: never collect bank data before payouts
           are live AND the user has reached the payout threshold. -->
      <ion-list inset v-if="r">
        <ion-list-header>{{ $t('referral.bankTitle') }}</ion-list-header>

        <!-- Not live yet: honest "in preparation" notice, no form. -->
        <ion-item v-if="!r.payoutsEnabled" lines="none" data-testid="referral-payouts-preparing">
          <ion-label class="ion-text-wrap">
            <p class="hint">{{ $t('referral.payoutsPreparing') }}</p>
          </ion-label>
        </ion-item>

        <!-- Live, but below threshold: tell them how much more to collect. -->
        <ion-item v-else-if="!payable" lines="none" data-testid="referral-below-threshold">
          <ion-label class="ion-text-wrap">
            <p class="hint">{{ $t('referral.thresholdHint', { amount: thresholdLabel }) }}</p>
          </ion-label>
        </ion-item>

        <!-- Live AND payable: show the bank form. -->
        <template v-else>
          <ion-item v-if="bank">
            <ion-label class="ion-text-wrap">
              <p class="hint">{{ $t('referral.bankSaved') }}</p>
              <h3 data-testid="referral-iban-preview">{{ bank.ibanPreview }} · {{ bank.holder }}</h3>
            </ion-label>
          </ion-item>
          <ion-item lines="none">
            <ion-label class="ion-text-wrap">
              <p class="hint">{{ $t('referral.bankEncryptedHint') }}</p>
            </ion-label>
          </ion-item>
          <ion-item>
            <ion-input v-model="holder" :label="$t('referral.holder')" label-placement="floating" />
          </ion-item>
          <ion-item>
            <ion-input v-model="iban" :label="$t('referral.iban')" label-placement="floating" autocapitalize="characters" />
          </ion-item>
          <ion-item>
            <ion-input v-model="bic" :label="$t('referral.bic')" label-placement="floating" autocapitalize="characters" />
          </ion-item>
          <p v-if="error" class="notice notice--error error" role="alert">{{ error }}</p>
          <ion-button
            expand="block"
            class="ion-margin"
            :disabled="saving || !valid"
            data-testid="referral-bank-save"
            @click="saveBank"
          >
            <ion-spinner v-if="saving" name="crescent" />
            <span v-else>{{ $t('referral.save') }}</span>
          </ion-button>
        </template>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import AppTopBar from '../../components/AppTopBar.vue'
import {
  IonBadge,
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonSpinner,
  toastController,
} from '@ionic/vue'
import { shareSocialOutline } from 'ionicons/icons'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useReferralStore } from '../../stores/referral.store'
import { apiErrorMessage } from '../../services/errors'
import { intlLocale, t } from '../../i18n'

const store = useReferralStore()
const { referral: r, bank } = storeToRefs(store)

const holder = ref('')
const iban = ref('')
const bic = ref('')
const saving = ref(false)
const error = ref('')

const valid = computed(() => holder.value.trim().length > 0 && iban.value.trim().length > 0 && bic.value.trim().length > 0)

// Fail closed: a missing threshold must NOT make every balance payable (which would
// expose the bank form early and render "0.00 EUR" copy). Treat absent as unreachable.
const thresholdCents = computed(() => r.value?.payoutThresholdCents ?? Number.POSITIVE_INFINITY)
// Payable once any currency's owed balance clears the threshold.
const payable = computed(() => (r.value?.earnings ?? []).some((e) => e.owedCents >= thresholdCents.value))
const hasPending = computed(() => (r.value?.earnings ?? []).some((e) => e.pendingCents > 0))
const hasPaid = computed(() => (r.value?.earnings ?? []).some((e) => e.paidCents > 0))
const thresholdLabel = computed(() => money(thresholdCents.value, 'eur'))

onMounted(async () => {
  await Promise.all([
    store.load().catch(() => undefined),
    store.loadBank().catch(() => undefined),
  ])
})

// Integer cents → localized currency (e.g. "10,00 €" in de)
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

// Earnings are per-currency; join into one label ("10,00 € · 2,00 $").
function earningsText(
  list: { currency: string; pendingCents: number; owedCents: number; paidCents: number }[],
  field: 'pendingCents' | 'owedCents' | 'paidCents',
): string {
  const nonZero = list.filter((e) => e[field] > 0)
  if (!nonZero.length) return money(0, 'eur')
  return nonZero.map((e) => money(e[field], e.currency)).join(' · ')
}

async function share() {
  const link = r.value?.link
  if (!link) return
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: t('referral.title'), text: t('referral.shareText'), url: link })
    return
  }
  await navigator.clipboard.writeText(link)
  const toast = await toastController.create({ message: t('referral.copied'), duration: 1500 })
  await toast.present()
}

async function saveBank() {
  error.value = ''
  saving.value = true
  try {
    await store.saveBank({ holder: holder.value, iban: iban.value, bic: bic.value })
    iban.value = ''
    const toast = await toastController.create({ message: t('referral.saved'), duration: 1500 })
    await toast.present()
  } catch (e) {
    error.value = apiErrorMessage(e, 'referral.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.intro {
  padding: var(--app-space-5) var(--app-space-4) var(--app-space-1);
}
.intro .prop {
  margin: 0;
  font-size: var(--app-text-xl);
  font-weight: 650;
  line-height: 1.3;
}
.intro p {
  margin: var(--app-space-2) 0 0;
  color: var(--app-ink-2);
}
.link {
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: var(--app-text-sm);
}
.hint {
  color: var(--ion-color-medium);
  font-size: 0.85em;
}
.error {
  margin: 8px 16px;
  font-size: 0.9em;
}
</style>
