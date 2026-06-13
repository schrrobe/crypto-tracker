import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HoldingDto, PortfolioSummaryDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from './portfolios.store'

export const usePortfolioStore = defineStore('portfolio', () => {
  const summary = ref<PortfolioSummaryDto | null>(null)
  const holdings = ref<HoldingDto[]>([])
  const loading = ref(false)

  async function loadSummary(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    summary.value = await api.get<PortfolioSummaryDto>(`/portfolio/summary${scope}`)
  }

  async function loadHoldings(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    holdings.value = (await api.get<{ holdings: HoldingDto[] }>(`/holdings${scope}`)).holdings
  }

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      await api.post('/prices/refresh', { portfolioId: usePortfoliosStore().scopeId() })
      await Promise.all([loadSummary(), loadHoldings()])
    } finally {
      loading.value = false
    }
  }

  async function createHolding(sourceId: string, assetId: string, quantity: string): Promise<void> {
    await api.post(`/sources/${sourceId}/holdings`, { assetId, quantity })
    await Promise.all([loadSummary(), loadHoldings()])
  }

  async function updateHolding(sourceId: string, holdingId: string, quantity: string): Promise<void> {
    await api.patch(`/sources/${sourceId}/holdings/${holdingId}`, { quantity })
    await Promise.all([loadSummary(), loadHoldings()])
  }

  async function deleteHolding(sourceId: string, holdingId: string): Promise<void> {
    await api.delete(`/sources/${sourceId}/holdings/${holdingId}`)
    await Promise.all([loadSummary(), loadHoldings()])
  }

  function reset(): void {
    summary.value = null
    holdings.value = []
  }

  return {
    summary,
    holdings,
    loading,
    loadSummary,
    loadHoldings,
    refresh,
    createHolding,
    updateHolding,
    deleteHolding,
    reset,
  }
})
