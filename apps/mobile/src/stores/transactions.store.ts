import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateTransactionInput, TransactionDto, UpdateTransactionInput } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useTransactionsStore = defineStore('transactions', () => {
  const transactions = ref<TransactionDto[]>([])

  async function load(): Promise<void> {
    transactions.value = (await api.get<{ transactions: TransactionDto[] }>('/transactions')).transactions
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
  }

  return { transactions, load, create, update, remove, linkTransfer, unlinkTransfer, reset }
})
