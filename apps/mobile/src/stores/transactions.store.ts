import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateTransactionInput, TransactionDto, UpdateTransactionInput } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useTransactionsStore = defineStore('transactions', () => {
  const transactions = ref<TransactionDto[]>([])
  // aktiver Quellen-Filter — bleibt über Mutations-Reloads erhalten
  const filterSourceId = ref<string | null>(null)

  // query angeben = Filter setzen (null hebt auf); ohne query = mit aktuellem Filter neu laden
  async function load(query?: { sourceId: string | null }): Promise<void> {
    if (query !== undefined) filterSourceId.value = query.sourceId
    const params = filterSourceId.value ? `?sourceId=${encodeURIComponent(filterSourceId.value)}` : ''
    transactions.value = (await api.get<{ transactions: TransactionDto[] }>(`/transactions${params}`)).transactions
  }

  async function create(input: CreateTransactionInput): Promise<void> {
    await api.post('/transactions', input)
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

  function reset(): void {
    transactions.value = []
    filterSourceId.value = null
  }

  return { transactions, filterSourceId, load, create, update, remove, linkTransfer, unlinkTransfer, reset }
})
