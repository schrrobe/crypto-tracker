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
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { applyStoredTheme } from './services/theme.service'
import { initNative } from './services/native'
import { openPaywall } from './services/paywall'
import type { ProFeature } from '@crypto-tracker/shared'
import PaywallModal from './components/PaywallModal.vue'
import UpdateGateModal from './components/UpdateGateModal.vue'
import AnnouncementBanner from './components/AnnouncementBanner.vue'
import { checkClientVersion } from './services/app-update'
import { useAuthStore } from './stores/auth.store'
import { useAnnouncementsStore } from './stores/announcements.store'

const router = useRouter()
const auth = useAuthStore()
const announcements = useAnnouncementsStore()

const POLL_MS = 60_000
let pollTimer: ReturnType<typeof setInterval> | null = null

// Authed users get all active announcements; logged-out users get the public
// subset (incident/maintenance banner on the login screen). The store collapses
// overlapping calls and fails closed; a failed refetch keeps prior banners.
function refresh(): void {
  const load = auth.user ? announcements.loadActive() : announcements.loadPublic()
  void load.catch((e) => console.warn('[announcements] load failed', e))
}

function onVisible(): void {
  if (document.visibilityState === 'visible') refresh()
}

// Refetch on every session transition (restore, login, logout). Clear authed
// banners ONLY on the logout transition (user → null) so non-public broadcasts
// can't linger on the login screen — not on every logged-out poll, which would
// blank the public banner and flicker.
watch(
  () => auth.user,
  (user, prev) => {
    if (!user && prev) announcements.reset()
    refresh()
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
  // api.client reports triggered Pro gates (402) → open the paywall, carrying the
  // feature discriminator so the paywall is contextual to what the user just hit.
  window.addEventListener('plan:upgrade', (e) =>
    openPaywall(((e as CustomEvent).detail as ProFeature | null) ?? null),
  )
  // Keep broadcasts fresh while the app is open + on foreground (covers Capacitor
  // resume, which raises visibilitychange). Skip ticks while hidden — onVisible
  // already refreshes on foreground, so polling a backgrounded tab just burns
  // network/battery.
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<style>
/* Push the routed content (and modals) below the fixed announcement stack so it
   never covers the Ionic toolbar. Height is published by AnnouncementBanner.vue. */
ion-router-outlet {
  top: var(--announcement-offset, 0px);
}
</style>
