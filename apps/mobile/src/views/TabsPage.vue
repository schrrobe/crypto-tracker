<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet />
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dashboard" href="/tabs/dashboard">
          <ion-icon :icon="readerOutline" aria-hidden="true" />
          <ion-label>{{ $t('tabs.dashboard') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="holdings" href="/tabs/holdings">
          <ion-icon :icon="layersOutline" aria-hidden="true" />
          <ion-label>{{ $t('tabs.holdings') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="sources" href="/tabs/sources">
          <ion-icon :icon="gitBranchOutline" aria-hidden="true" />
          <ion-label>{{ $t('tabs.sources') }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="market" href="/tabs/market">
          <ion-icon :icon="pulseOutline" aria-hidden="true" />
          <ion-label>{{ $t('tabs.market') }}</ion-label>
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
import { gitBranchOutline, layersOutline, pulseOutline, readerOutline } from 'ionicons/icons'
import { onMounted } from 'vue'
import { usePortfoliosStore } from '../stores/portfolios.store'

// Load portfolios once centrally — the switcher in the top bars needs them
const portfolios = usePortfoliosStore()
onMounted(() => {
  portfolios.ensureLoaded().catch(() => {})
})
</script>
