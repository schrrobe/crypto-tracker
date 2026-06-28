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
      <!-- Reward headline: both sides earn free Pro-time -->
      <ion-list inset v-if="r">
        <ion-item lines="none">
          <ion-label class="ion-text-wrap">
            <h2 class="reward-headline">{{ $t('referral.rewardHeadline', { days: r.rewardDays }) }}</h2>
            <p class="hint">{{ $t('referral.rewardSub', { days: r.rewardDays }) }}</p>
          </ion-label>
        </ion-item>
      </ion-list>

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

      <!-- Earned Pro-time -->
      <ion-list inset v-if="r">
        <ion-item>
          <ion-label>{{ $t('referral.earnedProDays') }}</ion-label>
          <ion-note slot="end" data-testid="referral-prodays">{{ r.earnedProDays }}</ion-note>
        </ion-item>
        <ion-item>
          <ion-label>{{ $t('referral.proConversions') }}</ion-label>
          <ion-note slot="end">{{ r.proConversions }}</ion-note>
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
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBackButton,
  IonBadge,
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
  IonTitle,
  IonToolbar,
  toastController,
} from '@ionic/vue'
import { shareSocialOutline } from 'ionicons/icons'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useReferralStore } from '../../stores/referral.store'
import { t } from '../../i18n'

const store = useReferralStore()
const { referral: r } = storeToRefs(store)

onMounted(async () => {
  await store.load().catch(() => undefined)
})

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
</script>

<style scoped>
.hint {
  color: var(--ion-color-medium);
  font-size: 0.85em;
}
.reward-headline {
  font-weight: 600;
}
</style>
