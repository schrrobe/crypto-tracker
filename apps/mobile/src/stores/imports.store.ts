import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CsvImportDto, CsvUploadResponse } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from './portfolios.store'

export const useImportsStore = defineStore('imports', () => {
  const imports = ref<CsvImportDto[]>([])

  async function load(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    imports.value = (await api.get<{ imports: CsvImportDto[] }>(`/imports${scope}`)).imports
  }

  async function upload(
    file: File,
    label: string,
    kind: 'BALANCES' | 'TRANSACTIONS',
  ): Promise<CsvUploadResponse> {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    if (label.trim()) form.append('label', label.trim())
    const portfolioId = usePortfoliosStore().scopeId()
    if (portfolioId) form.append('portfolioId', portfolioId)
    return api.upload<CsvUploadResponse>('/imports', form)
  }

  async function confirmMapping(
    importId: string,
    mapping: Record<string, string>,
  ): Promise<CsvImportDto> {
    const { import: result } = await api.post<{ import: CsvImportDto }>(
      `/imports/${importId}/mapping`,
      { mapping },
    )
    return result
  }

  async function remove(importId: string): Promise<void> {
    await api.delete(`/imports/${importId}`)
    imports.value = imports.value.filter((i) => i.id !== importId)
  }

  return { imports, load, upload, confirmMapping, remove }
})
