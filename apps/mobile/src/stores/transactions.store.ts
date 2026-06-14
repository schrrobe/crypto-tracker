import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateTransactionInput, TransactionDto, UpdateTransactionInput } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from './portfolios.store'

export const useTransactionsStore = defineStore('transactions', () => {
  const transactions = ref<TransactionDto[]>([])
  // active source filter — persists across mutation reloads
  const filterSourceId = ref<string | null>(null)

  // passing query = set the filter (null clears it); without query = reload with the current filter
  async function load(query?: { sourceId: string | null }): Promise<void> {
    if (query !== undefined) filterSourceId.value = query.sourceId
    const portfolios = usePortfoliosStore()
    const sourceParam = filterSourceId.value ? `?sourceId=${encodeURIComponent(filterSourceId.value)}` : ''
    const scope = portfolios.scopeQuery(sourceParam ? '&' : '?')
    transactions.value = (
      await api.get<{ transactions: TransactionDto[] }>(`/transactions${sourceParam}${scope}`)
    ).transactions
  }

  async function create(input: CreateTransactionInput): Promise<void> {
    await api.post('/transactions', { ...input, portfolioId: usePortfoliosStore().scopeId() })
    await load()
  }

  async function update(id: string, input: UpdateTransactionInput): Promise<void> {
    await api.patch(`/transactions/${id}`, input)
    await load()
  }

  async function remove(id: string): Promise<void> {
    await api.delete(`/transactions/${id}`)
    transactions.value = transactions.value.filter((t) => t.id !== id)
  }

  async function linkTransfer(id: string, counterpartId: string): Promise<void> {
    await api.post(`/transactions/${id}/transfer-link`, { counterpartId })
    await load()
  }

  async function unlinkTransfer(id: string): Promise<void> {
    await api.delete(`/transactions/${id}/transfer-link`)
    await load()
  }

  async function linkSwap(id: string, counterpartId: string): Promise<void> {
    await api.post(`/transactions/${id}/swap-link`, { counterpartId })
    await load()
  }

  async function unlinkSwap(id: string): Promise<void> {
    await api.delete(`/transactions/${id}/swap-link`)
    await load()
  }

  function reset(): void {
    transactions.value = []
    filterSourceId.value = null
  }

  return {
    transactions,
    filterSourceId,
    load,
    create,
    update,
    remove,
    linkTransfer,
    unlinkTransfer,
    linkSwap,
    unlinkSwap,
    reset,
  }
})
