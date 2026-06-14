import { defineStore } from 'pinia'
import { api } from '../services/api.client'
import { openExternal } from '../services/external-link'

// Stripe-Billing (Web). checkout/portal liefern eine URL; im Web Redirect,
// nativ später per IAP (Stripe-Checkout im In-App-Browser ist Übergangslösung).
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
