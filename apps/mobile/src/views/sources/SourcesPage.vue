<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Quellen</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true" class="ion-padding">
      <p>Noch keine Quellen verbunden. Exchange-, Wallet- und CSV-Quellen kommen ab Meilenstein 3.</p>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/vue'
</script>
