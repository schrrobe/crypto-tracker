import { ref } from 'vue'

// Global paywall state — opened by the 402 handling (api.client) and by
// gating UI (lock icons), rendered in App.vue via PaywallModal.
export const paywallOpen = ref(false)

export function openPaywall(): void {
  paywallOpen.value = true
}

export function closePaywall(): void {
  paywallOpen.value = false
}
