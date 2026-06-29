import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../services/api.client'
import { openExternal } from '../services/external-link'

// Stripe billing (web). checkout/portal return a URL; redirect on web,
// later via IAP on native (Stripe Checkout in the in-app browser is a stopgap).
export const useBillingStore = defineStore('billing', () => {
  // Billing availability + price label, fetched from the API. `enabled` lets the
  // paywall hide the Upgrade CTA (and "pay in browser" hint) when Stripe is not
  // configured, instead of showing a button that 503s.
  const enabled = ref(true)
  const priceLabel = ref<string | null>(null)
  const configLoaded = ref(false)

  async function loadConfig(): Promise<void> {
    if (configLoaded.value) return
    try {
      const cfg = await api.get<{ enabled: boolean; priceLabel: string | null }>('/billing/config')
      enabled.value = cfg.enabled
      priceLabel.value = cfg.priceLabel
      // Mark loaded only on success, so a transient failure retries on the next
      // paywall open instead of freezing the optimistic defaults for the session.
      configLoaded.value = true
    } catch {
      // Leave configLoaded=false → the next open retries.
    }
  }

  async function checkout(): Promise<void> {
    const { url } = await api.post<{ url: string }>('/billing/checkout')
    await openExternal(url)
  }

  async function openPortal(): Promise<void> {
    const { url } = await api.post<{ url: string }>('/billing/portal')
    await openExternal(url)
  }

  // Reconcile the plan from a completed Checkout session on success-return, so a
  // delayed/dropped webhook doesn't leave a paying user on FREE.
  async function reconcile(sessionId: string): Promise<{ plan: string }> {
    return api.post<{ plan: string }>('/billing/reconcile', { sessionId })
  }

  return { enabled, priceLabel, configLoaded, loadConfig, checkout, openPortal, reconcile }
})
