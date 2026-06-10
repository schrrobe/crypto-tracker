<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { applyStoredTheme } from './services/theme.service'
import { useAuthStore } from './stores/auth.store'

const router = useRouter()
const auth = useAuthStore()

onMounted(() => {
  applyStoredTheme()
  // api.client meldet abgelaufene Sessions (Refresh fehlgeschlagen)
  window.addEventListener('auth:expired', () => {
    auth.sessionExpired()
    router.replace('/login')
  })
})
</script>
