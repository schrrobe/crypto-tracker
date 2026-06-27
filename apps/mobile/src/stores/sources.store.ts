import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { CreateSourceInput, SourceDto, SyncRunDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from './portfolios.store'

export const useSourcesStore = defineStore('sources', () => {
  const sources = ref<SourceDto[]>([])
  const loaded = ref(false)

  async function load(): Promise<void> {
    const scope = usePortfoliosStore().scopeQuery()
    sources.value = (await api.get<{ sources: SourceDto[] }>(`/sources${scope}`)).sources
    loaded.value = true
  }

  // For manual holdings: use an existing manual source or create one
  async function ensureManualSource(): Promise<SourceDto> {
    if (!loaded.value) await load()
    const existing = sources.value.find((s) => s.type === 'MANUAL')
    if (existing) return existing
    const created = (
      await api.post<{ source: SourceDto }>('/sources', {
        type: 'MANUAL',
        label: 'Manuelle Bestände',
        portfolioId: usePortfoliosStore().writeScopeId(),
      })
    ).source
    sources.value.push(created)
    return created
  }

  async function rename(sourceId: string, label: string): Promise<void> {
    const { source } = await api.patch<{ source: SourceDto }>(`/sources/${sourceId}`, { label })
    sources.value = sources.value.map((s) => (s.id === sourceId ? source : s))
  }

  async function remove(sourceId: string): Promise<void> {
    await api.delete(`/sources/${sourceId}`)
    sources.value = sources.value.filter((s) => s.id !== sourceId)
  }

  async function create(input: CreateSourceInput): Promise<SourceDto> {
    const payload = { ...input, portfolioId: input.portfolioId ?? usePortfoliosStore().writeScopeId() }
    const created = (await api.post<{ source: SourceDto }>('/sources', payload)).source
    sources.value.push(created)
    return created
  }

  const syncing = ref<Set<string>>(new Set())

  // Queue mode: the API responds immediately with a RUNNING run — poll the
  // sync history until it completes (inline mode returns the finished result directly)
  const POLL_INTERVAL_MS = 2000
  const POLL_TIMEOUT_MS = 60_000

  async function waitForRun(sourceId: string, run: SyncRunDto): Promise<SyncRunDto> {
    if (run.status !== 'RUNNING') return run
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      const { runs } = await api.get<{ runs: SyncRunDto[] }>(`/sources/${sourceId}/sync-runs`)
      const current = runs.find((r) => r.id === run.id)
      if (current && current.status !== 'RUNNING') return current
    }
    return run
  }

  async function sync(sourceId: string): Promise<SyncRunDto> {
    syncing.value.add(sourceId)
    try {
      const { run } = await api.post<{ run: SyncRunDto }>(`/sources/${sourceId}/sync`)
      const finished = await waitForRun(sourceId, run)
      await load()
      return finished
    } finally {
      syncing.value.delete(sourceId)
    }
  }

  async function syncAll(): Promise<void> {
    const syncable = sources.value.filter((s) => s.type === 'EXCHANGE' || s.type === 'WALLET')
    syncable.forEach((s) => syncing.value.add(s.id))
    try {
      const { results } = await api.post<{ results: Array<{ sourceId: string; run: SyncRunDto }> }>(
        '/sources/sync-all',
        { portfolioId: usePortfoliosStore().writeScopeId() },
      )
      await Promise.all(results.map((r) => waitForRun(r.sourceId, r.run)))
      await load()
    } finally {
      syncable.forEach((s) => syncing.value.delete(s.id))
    }
  }

  function reset(): void {
    sources.value = []
    loaded.value = false
  }

  return { sources, loaded, syncing, load, ensureManualSource, create, rename, remove, sync, syncAll, reset }
})
