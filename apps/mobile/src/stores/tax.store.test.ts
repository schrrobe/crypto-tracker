import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/api.client', () => ({ api: { get: vi.fn() } }))
vi.mock('../services/storage', () => ({ getStored: vi.fn(() => 'DE'), setStored: vi.fn() }))
vi.mock('./portfolios.store', () => ({ usePortfoliosStore: () => ({ scopeQuery: () => '' }) }))

import { api } from '../services/api.client'
import { useTaxStore } from './tax.store'

const mockApi = api as unknown as { get: Mock }

const LIMIT = { code: 'PRICE_LOOKUP_LIMIT_REACHED', count: 5 }
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

  it('reloads (force) until the price-lookup-limit warning clears', async () => {
    mockApi.get
      .mockResolvedValueOnce(report([LIMIT])) // first load: capped
      .mockResolvedValueOnce(report([LIMIT])) // pass 1: still capped
      .mockResolvedValueOnce(report([])) // pass 2: cache full, warning gone
    const store = useTaxStore()
    await store.loadWithBackfill()
    expect(mockApi.get).toHaveBeenCalledTimes(3)
    expect(store.report?.warnings).toHaveLength(0)
    expect(store.backfilling).toBe(false)
  })

  it('stops after the max-pass bound even if the warning never clears', async () => {
    mockApi.get.mockResolvedValue(report([LIMIT]))
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
