import { ref } from 'vue'
import type { ProFeature } from '@crypto-tracker/shared'

// Global paywall state — opened by the 402 handling (api.client) and by
// gating UI (lock icons), rendered in App.vue via PaywallModal. The optional
// feature drives contextual copy (which limit/feature the user just hit).
export const paywallOpen = ref(false)
export const paywallFeature = ref<ProFeature | null>(null)

export function openPaywall(feature: ProFeature | null = null): void {
  paywallFeature.value = feature
  paywallOpen.value = true
}

export function closePaywall(): void {
  paywallOpen.value = false
}
