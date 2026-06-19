import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BankDetailsInput, ReferralBankDto, ReferralDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useReferralStore = defineStore('referral', () => {
  const referral = ref<ReferralDto | null>(null)
  const bank = ref<ReferralBankDto | null>(null)

  async function load(): Promise<void> {
    referral.value = await api.get<ReferralDto>('/referral')
  }

  async function loadBank(): Promise<void> {
    bank.value = await api.get<ReferralBankDto | null>('/referral/bank')
  }

  async function saveBank(input: BankDetailsInput): Promise<void> {
    bank.value = await api.put<ReferralBankDto>('/referral/bank', input)
  }

  return { referral, bank, load, loadBank, saveBank }
})
