import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MovementGroupDto, MovementsResponseDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { usePortfoliosStore } from './portfolios.store'
import { getStored, setStored } from '../services/storage'

const PAGE = 60
const SEEN_KEY = 'movements-seen-at'

export interface MovementFilter {
  sourceId?: string
  assetId?: string
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  } catch {
    return 'Europe/Berlin'
  }
}

// Statement lines (server-netted per day/source/asset). One list per filter is
// enough: the overview, asset detail and the full list each load their own.
export const useMovementsStore = defineStore('movements', () => {
  const groups = ref<MovementGroupDto[]>([])
  const historyDays = ref(30)
  const hasMore = ref(false)
  const loading = ref(false)
  const error = ref(false)
  const filter = ref<MovementFilter>({})
  // Lines booked after this moment get the "freshly booked" highlight once
  const seenAt = ref<string | null>(getStored(SEEN_KEY))
  // Snapshot taken per load so marking lines as seen does not cut the highlight short
  const freshCutoff = ref<string | null>(null)

  function query(offset: number, limit: number): string {
    const params = new URLSearchParams({ tz: timeZone(), limit: String(limit), offset: String(offset) })
    if (filter.value.sourceId) params.set('sourceId', filter.value.sourceId)
    if (filter.value.assetId) params.set('assetId', filter.value.assetId)
    return `/movements?${params.toString()}${usePortfoliosStore().scopeQuery('&')}`
  }

  async function load(next: MovementFilter = {}, limit = PAGE): Promise<void> {
    filter.value = next
    freshCutoff.value = seenAt.value
    loading.value = true
    error.value = false
    try {
      const res = await api.get<MovementsResponseDto>(query(0, limit))
      groups.value = res.groups
      historyDays.value = res.historyDays
      hasMore.value = res.hasMore
    } catch {
      error.value = true
      groups.value = []
      hasMore.value = false
    } finally {
      loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!hasMore.value || loading.value) return
    loading.value = true
    try {
      const res = await api.get<MovementsResponseDto>(query(groups.value.length, PAGE))
      groups.value = [...groups.value, ...res.groups]
      hasMore.value = res.hasMore
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  function isFresh(group: MovementGroupDto): boolean {
    return freshCutoff.value !== null && group.lastAt > freshCutoff.value
  }

  // Called when the user has seen the current lines; the highlight shows once
  function markSeen(): void {
    const newest = groups.value[0]?.lastAt
    if (!newest || (seenAt.value && newest <= seenAt.value)) return
    seenAt.value = newest
    setStored(SEEN_KEY, newest)
  }

  function reset(): void {
    groups.value = []
    hasMore.value = false
    error.value = false
    filter.value = {}
  }

  return { groups, historyDays, hasMore, loading, error, filter, load, loadMore, isFresh, markSeen, reset }
})
