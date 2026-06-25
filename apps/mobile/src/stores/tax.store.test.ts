import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/api.client', () => ({ api: { get: vi.fn() } }))
vi.mock('../services/storage', () => ({ getStored: vi.fn(() => 'DE'), setStored: vi.fn() }))
vi.mock('./portfolios.store', () => ({ usePortfoliosStore: () => ({ scopeQuery: () => '' }) }))

import { api } from '../services/api.client'
import { useTaxStore } from './tax.store'

const mockApi = api as unknown as { get: Mock }

const LIMIT = { code: 'PRICE_LOOKUP_LIMIT_REACHED', count: 5 }
const limit = (count: number) => ({ code: 'PRICE_LOOKUP_LIMIT_REACHED', count })
function report(warnings: unknown[] = []) {
  return {
    year: 2024,
    country: 'DE',
    currency: 'EUR',
    disposals: [],
    totals: {},
    warnings,
    uncoveredSources: [],
    generatedAt: '',
  }
}

describe('tax.store loadWithBackfill', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.get.mockReset()
  })

  it('reloads (force) while the open count keeps dropping, until the warning clears', async () => {
    mockApi.get
      .mockResolvedValueOnce(report([limit(5)])) // first load: 5 open
      .mockResolvedValueOnce(report([limit(3)])) // pass 1: progress (3 open)
      .mockResolvedValueOnce(report([])) // pass 2: cache full, warning gone
    const store = useTaxStore()
    await store.loadWithBackfill()
    expect(mockApi.get).toHaveBeenCalledTimes(3)
    expect(store.report?.warnings).toHaveLength(0)
    expect(store.backfilling).toBe(false)
  })

  it('stops after one non-progress pass (e.g. only out-of-window dates left)', async () => {
    // count never drops → re-fetching would burn the rate limit for nothing
    mockApi.get.mockResolvedValue(report([limit(5)]))
    const store = useTaxStore()
    await store.loadWithBackfill()
    // 1 initial load + 1 pass that made no progress = 2 (NOT the 20-pass bound)
    expect(mockApi.get).toHaveBeenCalledTimes(2)
    expect(store.backfilling).toBe(false)
  })

  it('stops at the max-pass bound when progress is real but slow', async () => {
    // strictly-decreasing count so the no-progress guard never trips
    let n = 1000
    mockApi.get.mockImplementation(() => Promise.resolve(report([limit((n -= 1))])))
    const store = useTaxStore()
    await store.loadWithBackfill()
    // 1 initial load + 20 backfill passes (MAX_BACKFILL_PASSES) = 21
    expect(mockApi.get).toHaveBeenCalledTimes(21)
    expect(store.backfilling).toBe(false)
  })

  it('stops on a transient error but keeps the already-loaded report', async () => {
    mockApi.get
      .mockResolvedValueOnce(report([LIMIT]))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'))
    const store = useTaxStore()
    await store.loadWithBackfill()
    expect(store.report?.warnings).toHaveLength(1) // first report retained
    expect(store.backfilling).toBe(false)
  })

  it('does not backfill when the first report has no limit warning', async () => {
    mockApi.get.mockResolvedValueOnce(report([]))
    const store = useTaxStore()
    await store.loadWithBackfill()
    expect(mockApi.get).toHaveBeenCalledTimes(1)
    expect(store.backfilling).toBe(false)
  })
})
