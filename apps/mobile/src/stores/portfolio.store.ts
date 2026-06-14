import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  FuturesPositionDto,
  HoldingDto,
  PortfolioPnlDto,
  PortfolioSummaryDto,
} from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from './portfolios.store'

export const usePortfolioStore = defineStore('portfolio', () => {
  const summary = ref<PortfolioSummaryDto | null>(null)
  const holdings = ref<HoldingDto[]>([])
  const futuresPositions = ref<FuturesPositionDto[]>([])
  const pnl = ref<PortfolioPnlDto | null>(null)
  const loading = ref(false)

  // Pro feature: on Free the API throws 402 → paywall (handled globally)
  async function loadPnl(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    pnl.value = await api.get<PortfolioPnlDto>(`/portfolio/pnl${scope}`)
  }

  async function loadSummary(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    summary.value = await api.get<PortfolioSummaryDto>(`/portfolio/summary${scope}`)
  }

  async function loadHoldings(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    holdings.value = (await api.get<{ holdings: HoldingDto[] }>(`/holdings${scope}`)).holdings
  }

  async function loadFuturesPositions(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    futuresPositions.value = (
      await api.get<{ positions: FuturesPositionDto[] }>(`/portfolio/futures${scope}`)
    ).positions
  }

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      await api.post('/prices/refresh', { portfolioId: usePortfoliosStore().scopeId() })
      await Promise.all([
        loadSummary(),
        loadHoldings(),
        loadFuturesPositions(),
        // Only refresh PnL if it was already loaded (Pro) — otherwise the
        // PnL card would stay on a stale value after pull-to-refresh.
        ...(pnl.value !== null ? [loadPnl().catch(() => {})] : []),
      ])
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
    futuresPositions.value = []
    pnl.value = null
  }

  return {
    summary,
    holdings,
    futuresPositions,
    pnl,
    loading,
    loadSummary,
    loadHoldings,
    loadFuturesPositions,
    loadPnl,
    refresh,
    createHolding,
    updateHolding,
    deleteHolding,
    reset,
  }
})
