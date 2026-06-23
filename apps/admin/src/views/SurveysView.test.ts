import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../services/admin', () => ({
  adminApi: {
    surveys: vi.fn(),
    publishSurvey: vi.fn(),
    closeSurvey: vi.fn(),
    deleteSurvey: vi.fn(),
  },
}))

import { adminApi } from '../services/admin'
import SurveysView from './SurveysView.vue'

const api = adminApi as unknown as {
  surveys: ReturnType<typeof vi.fn>
  publishSurvey: ReturnType<typeof vi.fn>
  closeSurvey: ReturnType<typeof vi.fn>
  deleteSurvey: ReturnType<typeof vi.fn>
}

const LIST = {
  surveys: [
    { id: '1', title: 'Entwurf-Umfrage', status: 'DRAFT', questionCount: 2, responseCount: 0, createdAt: '2026-06-01T00:00:00.000Z', publishedAt: null, closedAt: null },
    { id: '2', title: 'Live-Umfrage', status: 'PUBLISHED', questionCount: 3, responseCount: 5, createdAt: '2026-06-02T00:00:00.000Z', publishedAt: '2026-06-02T00:00:00.000Z', closedAt: null },
  ],
}

function mountView() {
  return mount(SurveysView, {
    global: { mocks: { $router: { push: vi.fn() } }, stubs: { 'router-link': true } },
  })
}

describe('SurveysView', () => {
  beforeEach(() => {
    api.surveys.mockReset().mockResolvedValue(LIST)
    api.publishSurvey.mockReset().mockResolvedValue(undefined)
    api.closeSurvey.mockReset().mockResolvedValue(undefined)
    api.deleteSurvey.mockReset().mockResolvedValue(undefined)
  })

  it('renders survey rows with status and response counts', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Entwurf-Umfrage')
    expect(w.text()).toContain('Live-Umfrage')
    expect(w.text()).toContain('Entwurf')
    expect(w.text()).toContain('Veröffentlicht')
    expect(w.text()).toContain('5')
  })

  it('shows Veröffentlichen only for drafts and publishes + reloads on click', async () => {
    const w = mountView()
    await flushPromises()
    const publishBtn = w.findAll('button').find((b) => b.text() === 'Veröffentlichen')
    expect(publishBtn).toBeTruthy()
    await publishBtn!.trigger('click')
    await flushPromises()
    expect(api.publishSurvey).toHaveBeenCalledWith('1')
    expect(api.surveys).toHaveBeenCalledTimes(2) // initial + reload
  })

  it('confirms before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const w = mountView()
    await flushPromises()
    const delBtn = w.findAll('button').find((b) => b.text() === 'Löschen')
    await delBtn!.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalled()
    expect(api.deleteSurvey).toHaveBeenCalledWith('1')
    confirmSpy.mockRestore()
  })
})
