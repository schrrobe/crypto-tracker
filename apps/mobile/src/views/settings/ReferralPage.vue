<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/tabs/settings" />
        </ion-buttons>
        <ion-title>{{ $t('referral.title') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <!-- Referral link -->
      <ion-list inset v-if="r">
        <ion-item>
          <ion-label class="ion-text-wrap">
            <p class="hint">{{ $t('referral.linkLabel') }}</p>
            <h3 data-testid="referral-link">{{ r.link }}</h3>
          </ion-label>
        </ion-item>
        <ion-item button data-testid="referral-share" @click="share">
          <ion-icon :icon="shareSocialOutline" slot="start" />
          <ion-label>{{ $t('referral.share') }}</ion-label>
        </ion-item>
      </ion-list>

      <!-- Earnings -->
      <ion-list inset v-if="r">
        <ion-item>
          <ion-label>{{ $t('referral.earningsOwed') }}</ion-label>
          <ion-note slot="end" data-testid="referral-owed">{{ earningsText(r.earnings, 'owedCents') }}</ion-note>
        </ion-item>
        <ion-item>
          <ion-label>{{ $t('referral.earningsPaid') }}</ion-label>
          <ion-note slot="end">{{ earningsText(r.earnings, 'paidCents') }}</ion-note>
        </ion-item>
      </ion-list>

      <!-- Invited accounts -->
      <ion-list inset v-if="r">
        <ion-list-header>{{ $t('referral.invited') }} ({{ r.invitedCount }})</ion-list-header>
        <ion-item v-if="r.invited.length === 0">
          <ion-label class="hint">{{ $t('referral.invitedEmpty') }}</ion-label>
        </ion-item>
        <ion-item v-for="(inv, i) in r.invited" :key="i">
          <ion-label>{{ inv.emailMasked }}</ion-label>
          <ion-badge v-if="inv.isPro" slot="end" color="success">Pro</ion-badge>
        </ion-item>
      </ion-list>

      <!-- Bank details for payout -->
      <ion-list inset>
        <ion-list-header>{{ $t('referral.bankTitle') }}</ion-list-header>
        <ion-item v-if="bank">
          <ion-label class="ion-text-wrap">
            <p class="hint">{{ $t('referral.bankSaved') }}</p>
            <h3 data-testid="referral-iban-preview">{{ bank.ibanPreview }} · {{ bank.holder }}</h3>
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
        <ion-text v-if="error" color="danger"><p class="error">{{ error }}</p></ion-text>
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
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  toastController,
} from '@ionic/vue'
import { shareSocialOutline } from 'ionicons/icons'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useReferralStore } from '../../stores/referral.store'
import { apiErrorMessage } from '../../services/errors'
import { t } from '../../i18n'

const store = useReferralStore()
const { referral: r, bank } = storeToRefs(store)

const holder = ref('')
const iban = ref('')
const bic = ref('')
const saving = ref(false)
const error = ref('')

const valid = computed(() => holder.value.trim().length > 0 && iban.value.trim().length > 0 && bic.value.trim().length > 0)

onMounted(async () => {
  await Promise.all([
    store.load().catch(() => undefined),
    store.loadBank().catch(() => undefined),
  ])
})

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

// Earnings are per-currency; join into one label ("10.00 EUR · 2.00 USD").
function earningsText(
  list: { currency: string; owedCents: number; paidCents: number }[],
  field: 'owedCents' | 'paidCents',
): string {
  if (!list.length) return '0.00'
  return list.map((e) => money(e[field], e.currency)).join(' · ')
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
.hint {
  color: var(--ion-color-medium);
  font-size: 0.85em;
}
.error {
  margin: 8px 16px;
  font-size: 0.9em;
}
</style>
