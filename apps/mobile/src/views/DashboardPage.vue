<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Dashboard</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <ion-card>
        <ion-card-header>
          <ion-card-subtitle>Gesamtwert</ion-card-subtitle>
          <ion-card-title class="amount">–,– €</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          Portfolio-Daten kommen in Meilenstein 2.
          <p class="api-status">
            API-Status:
            <ion-text :color="apiStatus === 'ok' ? 'success' : 'danger'">{{ apiStatus }}</ion-text>
          </p>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { onMounted, ref } from 'vue'
import { api } from '../services/api.client'

const apiStatus = ref('prüfe…')

onMounted(async () => {
  try {
    const health = await api.get<{ status: string }>('/health')
    apiStatus.value = health.status
  } catch {
    apiStatus.value = 'nicht erreichbar'
  }
})
</script>

<style scoped>
.api-status {
  margin-top: 8px;
  font-size: 0.85em;
}
</style>
