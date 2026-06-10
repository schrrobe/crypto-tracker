<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet />
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dashboard" href="/tabs/dashboard">
          <ion-icon :icon="statsChartOutline" />
          <ion-label>Dashboard</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="holdings" href="/tabs/holdings">
          <ion-icon :icon="walletOutline" />
          <ion-label>Bestände</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="sources" href="/tabs/sources">
          <ion-icon :icon="linkOutline" />
          <ion-label>Quellen</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon :icon="settingsOutline" />
          <ion-label>Einstellungen</ion-label>
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
import { linkOutline, settingsOutline, statsChartOutline, walletOutline } from 'ionicons/icons'
</script>
