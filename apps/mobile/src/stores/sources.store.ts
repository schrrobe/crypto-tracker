import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SourceDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useSourcesStore = defineStore('sources', () => {
  const sources = ref<SourceDto[]>([])
  const loaded = ref(false)

  async function load(): Promise<void> {
    sources.value = (await api.get<{ sources: SourceDto[] }>('/sources')).sources
    loaded.value = true
  }

  // Für manuelle Bestände: vorhandene manuelle Quelle nutzen oder eine anlegen
  async function ensureManualSource(): Promise<SourceDto> {
    if (!loaded.value) await load()
    const existing = sources.value.find((s) => s.type === 'MANUAL')
    if (existing) return existing
    const created = (
      await api.post<{ source: SourceDto }>('/sources', { type: 'MANUAL', label: 'Manuelle Bestände' })
    ).source
    sources.value.push(created)
    return created
  }

  async function remove(sourceId: string): Promise<void> {
    await api.delete(`/sources/${sourceId}`)
    sources.value = sources.value.filter((s) => s.id !== sourceId)
  }

  function reset(): void {
    sources.value = []
    loaded.value = false
  }

  return { sources, loaded, load, ensureManualSource, remove, reset }
})
