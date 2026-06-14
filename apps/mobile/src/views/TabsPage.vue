<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet />
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dashboard" href="/tabs/dashboard">
          <ion-icon :icon="statsChartOutline" />
          <ion-label>{{ $t('tabs.dashboard') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="holdings" href="/tabs/holdings">
          <ion-icon :icon="walletOutline" />
          <ion-label>{{ $t('tabs.holdings') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="market" href="/tabs/market">
          <ion-icon :icon="trendingUpOutline" />
          <ion-label>{{ $t('tabs.market') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="sources" href="/tabs/sources">
          <ion-icon :icon="linkOutline" />
          <ion-label>{{ $t('tabs.sources') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon :icon="settingsOutline" />
          <ion-label>{{ $t('tabs.settings') }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonIcon,
  IonLabel,
  IonPage,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/vue'
import {
  linkOutline,
  settingsOutline,
  statsChartOutline,
  trendingUpOutline,
  walletOutline,
} from 'ionicons/icons'
import { onMounted } from 'vue'
import { usePortfoliosStore } from '../stores/portfolios.store'

// Load portfolios once centrally — the switcher in the tab headers needs them
const portfolios = usePortfoliosStore()
onMounted(() => {
  portfolios.ensureLoaded().catch(() => {})
})
</script>
