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

const LIST = {
  announcements: [
    { id: '1', level: 'ERROR', message: 'API gestört', active: true, startsAt: null, endsAt: null, createdAt: '2026-06-01T00:00:00.000Z' },
    { id: '2', level: 'INFO', message: 'Wartung geplant', active: false, startsAt: null, endsAt: null, createdAt: '2026-06-02T00:00:00.000Z' },
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

  it('renders announcements with level labels and status', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('API gestört')
    expect(w.text()).toContain('Wartung geplant')
    expect(w.text()).toContain('Fehler')
    expect(w.text()).toContain('Info')
    expect(w.text()).toContain('aktiv')
  })

  it('creates an announcement with the form payload', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('select').setValue('ERROR')
    await w.find('input[placeholder="Nachricht"]').setValue('Neuer Hinweis')
    const createBtn = w.findAll('button').find((b) => b.text() === 'Anlegen')!
    await createBtn.trigger('click')
    await flushPromises()
    expect(api.createAnnouncement).toHaveBeenCalledTimes(1)
    const payload = api.createAnnouncement.mock.calls[0]![0]
    expect(payload).toMatchObject({ level: 'ERROR', message: 'Neuer Hinweis', active: true })
    expect(api.announcements).toHaveBeenCalledTimes(2) // initial + reload
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
