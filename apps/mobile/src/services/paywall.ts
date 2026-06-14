import { ref } from 'vue'

// Globaler Paywall-Zustand — von der 402-Behandlung (api.client) und von
// Gating-UI (Schloss-Icons) geöffnet, gerendert in App.vue via PaywallModal.
export const paywallOpen = ref(false)

export function openPaywall(): void {
  paywallOpen.value = true
}

export function closePaywall(): void {
  paywallOpen.value = false
}
