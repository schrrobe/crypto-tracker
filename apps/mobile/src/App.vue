<template>
  <ion-app>
    <AnnouncementBanner />
    <ion-router-outlet />
    <PaywallModal />
    <UpdateGateModal />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue'
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { applyStoredTheme } from './services/theme.service'
import { initNative } from './services/native'
import { openPaywall } from './services/paywall'
import PaywallModal from './components/PaywallModal.vue'
import UpdateGateModal from './components/UpdateGateModal.vue'
import AnnouncementBanner from './components/AnnouncementBanner.vue'
import { checkClientVersion } from './services/app-update'
import { useAuthStore } from './stores/auth.store'
import { useAnnouncementsStore } from './stores/announcements.store'

const router = useRouter()
const auth = useAuthStore()
const announcements = useAnnouncementsStore()

// Load broadcast announcements whenever a user is signed in (initial restore or
// fresh login); clear them on logout. Covers all session transitions in one place.
watch(
  () => auth.user,
  (user) => {
    if (user) void announcements.loadActive().catch(() => {})
    else announcements.reset()
  },
  { immediate: true },
)

onMounted(() => {
  applyStoredTheme()
  void initNative(router)
  // Native-only force-update check; fails open on any error (see app-update.ts)
  void checkClientVersion()
  // api.client reports expired sessions (refresh failed)
  window.addEventListener('auth:expired', () => {
    auth.sessionExpired()
    router.replace('/login')
  })
  // api.client reports triggered Pro gates (402) → open the paywall
  window.addEventListener('plan:upgrade', () => openPaywall())
})
</script>
