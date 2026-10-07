<template>
  <ion-header>
    <ion-toolbar>
      <ion-buttons v-if="backHref" slot="start">
        <ion-back-button :default-href="backHref" :text="$t('common.back')" />
      </ion-buttons>
      <ion-buttons v-else-if="showSwitcher" slot="start">
        <PortfolioSwitcher @switched="emit('switched')" />
      </ion-buttons>
      <ion-title>
        <span role="heading" aria-level="1">{{ title }}</span>
      </ion-title>
      <ion-buttons slot="end">
        <slot name="end" />
        <ion-button
          v-if="showPrivacy"
          data-testid="toggle-balances"
          :aria-label="$t('common.toggleBalances')"
          :aria-pressed="balancesHidden ? 'true' : 'false'"
          :title="$t('common.toggleBalances')"
          @click="toggleBalances"
        >
          <ion-icon slot="icon-only" :icon="balancesHidden ? eyeOffOutline : eyeOutline" aria-hidden="true" />
        </ion-button>
        <ion-button
          v-if="showProfile"
          data-testid="open-settings"
          :aria-label="$t('ui.nav.profile')"
          :title="$t('ui.nav.profile')"
          router-link="/tabs/settings"
        >
          <span class="avatar" aria-hidden="true">{{ initial }}</span>
        </ion-button>
      </ion-buttons>
    </ion-toolbar>
    <slot name="below" />
  </ion-header>
</template>

<script setup lang="ts">
import { IonBackButton, IonButton, IonButtons, IonHeader, IonIcon, IonTitle, IonToolbar } from '@ionic/vue'
import { eyeOffOutline, eyeOutline } from 'ionicons/icons'
import { computed } from 'vue'
import PortfolioSwitcher from './PortfolioSwitcher.vue'
import { balancesHidden, toggleBalances } from '../services/privacy'
import { useAuthStore } from '../stores/auth.store'

// One top bar for every screen: tax-entity switcher (or back), title, privacy
// toggle and the profile entry that replaces the former settings tab.
withDefaults(
  defineProps<{
    title: string
    backHref?: string
    showSwitcher?: boolean
    showPrivacy?: boolean
    showProfile?: boolean
  }>(),
  { backHref: undefined, showSwitcher: true, showPrivacy: true, showProfile: true },
)
const emit = defineEmits<{ switched: [] }>()

const auth = useAuthStore()
const initial = computed(() => (auth.user?.email?.[0] ?? '·').toUpperCase())
</script>

<style scoped>
.avatar {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--app-ink);
  color: var(--app-ground);
  font-size: var(--app-text-sm);
  font-weight: 700;
}
</style>
