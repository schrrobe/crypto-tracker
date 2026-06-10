<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Bestände</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true" class="ion-padding">
      <p>Noch keine Bestände. Manuelle Erfassung kommt in Meilenstein 2.</p>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/vue'
</script>
