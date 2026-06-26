import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('../services/admin', () => ({
  adminApi: {
    surveys: vi.fn(),
    publishSurvey: vi.fn(),
    closeSurvey: vi.fn(),
    deleteSurvey: vi.fn(),
    remindSurvey: vi.fn(),
  },
}))

import { adminApi } from '../services/admin'
import SurveysView from './SurveysView.vue'

const api = adminApi as unknown as {
  surveys: ReturnType<typeof vi.fn>
  publishSurvey: ReturnType<typeof vi.fn>
  closeSurvey: ReturnType<typeof vi.fn>
  deleteSurvey: ReturnType<typeof vi.fn>
  remindSurvey: ReturnType<typeof vi.fn>
}

const LIST = {
  surveys: [
    { id: '1', title: 'Entwurf-Umfrage', status: 'DRAFT', anonymous: false, targetPlans: [], targetCurrencies: [], eligibleCount: 100, lastRemindedAt: null, questionCount: 2, responseCount: 0, createdAt: '2026-06-01T00:00:00.000Z', publishedAt: null, closedAt: null },
    { id: '2', title: 'Live-Umfrage', status: 'PUBLISHED', anonymous: true, targetPlans: ['PRO'], targetCurrencies: ['EUR'], eligibleCount: 12, lastRemindedAt: null, questionCount: 3, responseCount: 5, createdAt: '2026-06-02T00:00:00.000Z', publishedAt: '2026-06-02T00:00:00.000Z', closedAt: null },
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
    api.remindSurvey
      .mockReset()
      .mockResolvedValue({ notified: 4, eligibleCount: 12, alreadyResponded: 5, skippedCooldown: false, lastRemindedAt: '2026-06-26T00:00:00.000Z' })
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

  it('shows an anonymity badge and targeting summary', async () => {
    const w = mountView()
    await flushPromises()
    // anonymous badge on the published survey
    expect(w.text()).toContain('anonym')
    // targeting summary: plan + currency + eligible count, and "Alle" for the untargeted draft
    expect(w.text()).toContain('PRO')
    expect(w.text()).toContain('EUR')
    expect(w.text()).toContain('(12)')
    expect(w.text()).toContain('Alle')
  })

  it('shows Remind button only for PUBLISHED surveys and surfaces the notified count', async () => {
    const w = mountView()
    await flushPromises()
    const remindBtns = w.findAll('button').filter((b) => b.text().includes('erinnern'))
    // only the PUBLISHED survey row has it
    expect(remindBtns).toHaveLength(1)
    await remindBtns[0]!.trigger('click')
    await flushPromises()
    expect(api.remindSurvey).toHaveBeenCalledWith('2')
    expect(w.text()).toContain('4 erinnert')
  })

  it('shows a cooldown message when the reminder was skipped', async () => {
    api.remindSurvey.mockResolvedValue({ notified: 0, eligibleCount: 12, alreadyResponded: 5, skippedCooldown: true, lastRemindedAt: '2026-06-26T00:00:00.000Z' })
    const w = mountView()
    await flushPromises()
    const remindBtn = w.findAll('button').find((b) => b.text().includes('erinnern'))!
    await remindBtn.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Cooldown')
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
