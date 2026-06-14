import { defineStore } from 'pinia'
import { api } from '../services/api.client'
import { openExternal } from '../services/external-link'

// Stripe billing (web). checkout/portal return a URL; redirect on web,
// later via IAP on native (Stripe Checkout in the in-app browser is a stopgap).
export const useBillingStore = defineStore('billing', () => {
  async function checkout(): Promise<void> {
    const { url } = await api.post<{ url: string }>('/billing/checkout')
    await openExternal(url)
  }

  async function openPortal(): Promise<void> {
    const { url } = await api.post<{ url: string }>('/billing/portal')
    await openExternal(url)
  }

  return { checkout, openPortal }
})
