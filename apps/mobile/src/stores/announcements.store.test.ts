import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/api.client', () => ({ api: { get: vi.fn() } }))
vi.mock('../services/storage', () => ({ getStored: vi.fn(), setStored: vi.fn() }))

import { api } from '../services/api.client'
import { getStored, setStored } from '../services/storage'
import { useAnnouncementsStore } from './announcements.store'

const mockGet = (api as unknown as { get: Mock }).get
const mockGetStored = getStored as unknown as Mock
const mockSetStored = setStored as unknown as Mock

function ann(id: string, level: 'ERROR' | 'INFO' = 'INFO') {
  return { id, level, message: `msg ${id}` }
}

describe('announcements.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGet.mockReset()
    mockGetStored.mockReset().mockReturnValue(null)
    mockSetStored.mockReset()
  })

  it('loadActive fills active from the API', async () => {
    mockGet.mockResolvedValue({ announcements: [ann('a', 'ERROR'), ann('b')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    expect(mockGet).toHaveBeenCalledWith('/announcements/active')
    expect(store.active.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('visible excludes already-dismissed ids (seeded from storage)', async () => {
    mockGetStored.mockReturnValue(JSON.stringify(['a']))
    mockGet.mockResolvedValue({ announcements: [ann('a'), ann('b')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    expect(store.visible.map((a) => a.id)).toEqual(['b'])
  })

  it('dismiss hides the banner and persists the id', async () => {
    mockGet.mockResolvedValue({ announcements: [ann('a'), ann('b')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    store.dismiss('a')
    expect(store.visible.map((a) => a.id)).toEqual(['b'])
    expect(mockSetStored).toHaveBeenCalledWith('dismissed-announcements', JSON.stringify(['a']))
  })

  it('reset clears active but keeps dismissed', async () => {
    mockGetStored.mockReturnValue(JSON.stringify(['x']))
    mockGet.mockResolvedValue({ announcements: [ann('a')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    store.reset()
    expect(store.active).toHaveLength(0)
    expect(store.dismissed).toEqual(['x'])
  })
})
