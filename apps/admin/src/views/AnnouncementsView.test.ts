import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../services/admin', () => ({
  adminApi: {
    announcements: vi.fn(),
    createAnnouncement: vi.fn(),
    updateAnnouncement: vi.fn(),
    deleteAnnouncement: vi.fn(),
  },
}))

import { adminApi } from '../services/admin'
import AnnouncementsView from './AnnouncementsView.vue'

const api = adminApi as unknown as {
  announcements: ReturnType<typeof vi.fn>
  createAnnouncement: ReturnType<typeof vi.fn>
  updateAnnouncement: ReturnType<typeof vi.fn>
  deleteAnnouncement: ReturnType<typeof vi.fn>
}

const base = { defaultLocale: 'de', dismissible: true, public: false, startsAt: null, endsAt: null, updatedAt: '2026-06-01T00:00:00.000Z' }
const LIST = {
  announcements: [
    { id: '1', level: 'ERROR', messages: { de: 'API gestört' }, active: true, createdAt: '2026-06-01T00:00:00.000Z', ...base },
    { id: '2', level: 'INFO', messages: { de: 'Wartung geplant' }, active: false, createdAt: '2026-06-02T00:00:00.000Z', ...base },
  ],
}

function mountView() {
  return mount(AnnouncementsView)
}

describe('AnnouncementsView', () => {
  beforeEach(() => {
    api.announcements.mockReset().mockResolvedValue(LIST)
    api.createAnnouncement.mockReset().mockResolvedValue({ announcement: {} })
    api.updateAnnouncement.mockReset().mockResolvedValue({ announcement: {} })
    api.deleteAnnouncement.mockReset().mockResolvedValue(undefined)
  })

  it('renders announcements with level labels and computed status', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('API gestört')
    expect(w.text()).toContain('Wartung geplant')
    expect(w.text()).toContain('Störung')
    expect(w.text()).toContain('Info')
    expect(w.text()).toContain('LIVE') // id1 active, no window
    expect(w.text()).toContain('Inaktiv') // id2 inactive
  })

  it('shows a loading state before data resolves', async () => {
    let resolve!: (v: unknown) => void
    api.announcements.mockReturnValue(new Promise((r) => (resolve = r)))
    const w = mountView()
    expect(w.text()).toContain('Lädt')
    resolve(LIST)
    await flushPromises()
    expect(w.text()).not.toContain('Lädt')
  })

  it('creates an announcement with the per-locale payload', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('select').setValue('ERROR') // first select = level
    await w.findAll('textarea')[0]!.setValue('Neuer Hinweis') // first textarea = de (default locale)
    const createBtn = w.findAll('button').find((b) => b.text() === 'Anlegen')!
    await createBtn.trigger('click')
    await flushPromises()
    expect(api.createAnnouncement).toHaveBeenCalledTimes(1)
    const payload = api.createAnnouncement.mock.calls[0]![0]
    expect(payload).toMatchObject({ level: 'ERROR', messages: { de: 'Neuer Hinweis' }, defaultLocale: 'de', active: true })
    expect(api.announcements).toHaveBeenCalledTimes(2) // initial + reload
  })

  it('loads a row into the form for editing', async () => {
    const w = mountView()
    await flushPromises()
    const editBtn = w.findAll('button').find((b) => b.text() === 'Bearbeiten')!
    await editBtn.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Ankündigung bearbeiten')
    expect((w.findAll('textarea')[0]!.element as HTMLTextAreaElement).value).toBe('API gestört')
  })

  it('toggles active state via update', async () => {
    const w = mountView()
    await flushPromises()
    const toggle = w.findAll('button').find((b) => b.text() === 'Deaktivieren')!
    await toggle.trigger('click')
    await flushPromises()
    expect(api.updateAnnouncement).toHaveBeenCalledWith('1', { active: false })
  })

  it('confirms before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = mountView()
    await flushPromises()
    const delBtn = w.findAll('button').find((b) => b.text() === 'Löschen')!
    await delBtn.trigger('click')
    await flushPromises()
    expect(api.deleteAnnouncement).toHaveBeenCalledWith('1')
    confirmSpy.mockRestore()
  })
})
