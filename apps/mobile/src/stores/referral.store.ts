import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ReferralDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useReferralStore = defineStore('referral', () => {
  const referral = ref<ReferralDto | null>(null)

  async function load(): Promise<void> {
    // Clear first so a revisit never renders the previous snapshot, and a failed
    // reload leaves no stale counts/link behind (the caller surfaces the error).
    referral.value = null
    try {
      referral.value = await api.get<ReferralDto>('/referral')
    } catch (error) {
      referral.value = null
      throw error
    }
  }

  return { referral, load }
})
