<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
import { onMounted } from 'vue'
import { applyStoredTheme } from './services/theme.service'

onMounted(() => {
  applyStoredTheme()
})
</script>
