import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/api.client', () => ({ api: { get: vi.fn() }, apiBaseUrl: () => 'http://api.test' }))
vi.mock('../services/storage', () => ({ getStored: vi.fn(), setStored: vi.fn() }))

import { api } from '../services/api.client'
import { getStored, setStored } from '../services/storage'
import { useAnnouncementsStore } from './announcements.store'

const mockGet = (api as unknown as { get: Mock }).get
const mockGetStored = getStored as unknown as Mock
const mockSetStored = setStored as unknown as Mock

const UPDATED = '2026-01-01T00:00:00.000Z'
function ann(id: string, level: 'ERROR' | 'INFO' = 'INFO', updatedAt = UPDATED) {
  return { id, level, messages: { de: `msg ${id}` }, defaultLocale: 'de', dismissible: true, updatedAt }
}
const keyOf = (id: string, updatedAt = UPDATED) => `${id}:${updatedAt}`

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

  it('visible excludes already-dismissed keys (seeded from storage)', async () => {
    mockGetStored.mockReturnValue(JSON.stringify([keyOf('a')]))
    mockGet.mockResolvedValue({ announcements: [ann('a'), ann('b')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    expect(store.visible.map((a) => a.id)).toEqual(['b'])
  })

  it('dismiss hides the banner and persists the id:updatedAt key', async () => {
    mockGet.mockResolvedValue({ announcements: [ann('a'), ann('b')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    store.dismiss(store.active[0]!)
    expect(store.visible.map((a) => a.id)).toEqual(['b'])
    expect(mockSetStored).toHaveBeenCalledWith('dismissed-announcements', JSON.stringify([keyOf('a')]))
  })

  it('edited announcement (new updatedAt) re-surfaces after dismiss', async () => {
    mockGetStored.mockReturnValue(JSON.stringify([keyOf('a')]))
    mockGet.mockResolvedValue({ announcements: [ann('a', 'INFO', '2026-02-02T00:00:00.000Z')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    expect(store.visible.map((a) => a.id)).toEqual(['a'])
  })

  it('prunes dismissed keys that no longer match a live announcement', async () => {
    mockGetStored.mockReturnValue(JSON.stringify([keyOf('gone'), keyOf('a')]))
    mockGet.mockResolvedValue({ announcements: [ann('a')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    expect(store.dismissed).toEqual([keyOf('a')])
    expect(mockSetStored).toHaveBeenCalledWith('dismissed-announcements', JSON.stringify([keyOf('a')]))
  })

  it('collapses overlapping loads into a single request (in-flight guard)', async () => {
    let resolve!: (v: unknown) => void
    mockGet.mockReturnValue(new Promise((r) => (resolve = r)))
    const store = useAnnouncementsStore()
    const p1 = store.loadActive()
    const p2 = store.loadActive()
    resolve({ announcements: [ann('a')] })
    await Promise.all([p1, p2])
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('a logout loadPublic supersedes an in-flight authed loadActive (no leak)', async () => {
    let resolveActive!: (v: unknown) => void
    mockGet.mockReturnValue(new Promise((r) => (resolveActive = r)))
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ announcements: [ann('public-only', 'ERROR')] }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useAnnouncementsStore()

    const pActive = store.loadActive() // in flight (authed; would include non-public)
    const pPublic = store.loadPublic() // logout transition supersedes
    await pPublic
    resolveActive({ announcements: [ann('authed-secret')] }) // authed result lands late
    await pActive

    expect(store.active.map((a) => a.id)).toEqual(['public-only']) // late authed result discarded
    vi.unstubAllGlobals()
  })

  it('loadPublic fetches the public endpoint without auth and fails closed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ announcements: [ann('p', 'ERROR')] }) })
    vi.stubGlobal('fetch', fetchMock)
    const store = useAnnouncementsStore()
    await store.loadPublic()
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/announcements/public')
    expect(store.active.map((a) => a.id)).toEqual(['p'])
    vi.unstubAllGlobals()
  })

  it('reset clears active but keeps dismissed', async () => {
    mockGetStored.mockReturnValue(JSON.stringify([keyOf('x')]))
    mockGet.mockResolvedValue({ announcements: [ann('x')] })
    const store = useAnnouncementsStore()
    await store.loadActive()
    store.reset()
    expect(store.active).toHaveLength(0)
    expect(store.dismissed).toEqual([keyOf('x')])
  })
})
