import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ReferralDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useReferralStore = defineStore('referral', () => {
  const referral = ref<ReferralDto | null>(null)

  async function load(): Promise<void> {
    referral.value = await api.get<ReferralDto>('/referral')
  }

  return { referral, load }
})
