import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateSourceInput, SourceDto, SyncRunDto } from '@crypto-tracker/shared'
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

  async function create(input: CreateSourceInput): Promise<SourceDto> {
    const created = (await api.post<{ source: SourceDto }>('/sources', input)).source
    sources.value.push(created)
    return created
  }

  const syncing = ref<Set<string>>(new Set())

  async function sync(sourceId: string): Promise<SyncRunDto> {
    syncing.value.add(sourceId)
    try {
      const { run } = await api.post<{ run: SyncRunDto }>(`/sources/${sourceId}/sync`)
      await load()
      return run
    } finally {
      syncing.value.delete(sourceId)
    }
  }

  async function syncAll(): Promise<void> {
    const syncable = sources.value.filter((s) => s.type === 'EXCHANGE' || s.type === 'WALLET')
    syncable.forEach((s) => syncing.value.add(s.id))
    try {
      await api.post('/sources/sync-all')
      await load()
    } finally {
      syncable.forEach((s) => syncing.value.delete(s.id))
    }
  }

  function reset(): void {
    sources.value = []
    loaded.value = false
  }

  return { sources, loaded, syncing, load, ensureManualSource, create, remove, sync, syncAll, reset }
})
