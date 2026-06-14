<template>
  <ion-app>
    <ion-router-outlet />
    <PaywallModal />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { applyStoredTheme } from './services/theme.service'
import { initNative } from './services/native'
import { openPaywall } from './services/paywall'
import PaywallModal from './components/PaywallModal.vue'
import { useAuthStore } from './stores/auth.store'

const router = useRouter()
const auth = useAuthStore()

onMounted(() => {
  applyStoredTheme()
  void initNative(router)
  // api.client meldet abgelaufene Sessions (Refresh fehlgeschlagen)
  window.addEventListener('auth:expired', () => {
    auth.sessionExpired()
    router.replace('/login')
  })
  // api.client meldet getroffene Pro-Gates (402) → Paywall öffnen
  window.addEventListener('plan:upgrade', () => openPaywall())
})
</script>
