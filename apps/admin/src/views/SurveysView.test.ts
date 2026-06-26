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

const push = vi.fn()

function mountView() {
  return mount(SurveysView, {
    global: { mocks: { $router: { push } }, stubs: { 'router-link': true } },
  })
}

describe('SurveysView', () => {
  beforeEach(() => {
    push.mockReset()
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
  })

  it('shows a loading skeleton while data is null', () => {
    api.surveys.mockReturnValue(new Promise(() => {})) // never resolves
    const w = mountView()
    expect(w.find('.animate-pulse').exists()).toBe(true)
  })

  it('shows a response-rate column with pct and count/eligible', async () => {
    const w = mountView()
    await flushPromises()
    // draft: 0/100 -> 0%
    expect(w.text()).toContain('0% · 0/100')
    // published: 5/12 -> 42%
    expect(w.text()).toContain('42% · 5/12')
  })

  it('shows a pre-publish summary in a confirm modal and publishes on confirm', async () => {
    const w = mountView()
    await flushPromises()
    const publishBtn = w.findAll('button').find((b) => b.text() === 'Veröffentlichen')!
    await publishBtn.trigger('click')
    await flushPromises()
    // modal shows the summary
    expect(w.text()).toContain('Erreicht ~100 Nutzer')
    expect(w.text()).toContain('Kann danach nicht mehr bearbeitet werden')
    // confirm inside the dialog
    const confirmBtn = w.findAll('button').filter((b) => b.text() === 'Veröffentlichen').at(-1)!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(api.publishSurvey).toHaveBeenCalledWith('1')
    expect(api.surveys).toHaveBeenCalledTimes(2) // initial + reload
  })

  it('cancelling the publish modal does not publish', async () => {
    const w = mountView()
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Veröffentlichen')!.trigger('click')
    await flushPromises()
    await w.findAll('button').find((b) => b.text() === 'Abbrechen')!.trigger('click')
    await flushPromises()
    expect(api.publishSurvey).not.toHaveBeenCalled()
  })

  it('confirms before closing a published survey', async () => {
    const w = mountView()
    await flushPromises()
    const closeBtn = w.findAll('button').find((b) => b.text() === 'Schließen')!
    await closeBtn.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Nutzer können dann nicht mehr antworten')
    const confirmBtn = w.findAll('button').filter((b) => b.text() === 'Schließen').at(-1)!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(api.closeSurvey).toHaveBeenCalledWith('2')
  })

  it('shows an anonymity badge and targeting summary', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('anonym')
    expect(w.text()).toContain('PRO')
    expect(w.text()).toContain('EUR')
    expect(w.text()).toContain('(12)')
    expect(w.text()).toContain('Alle')
  })

  it('navigates to the edit route for draft rows', async () => {
    const w = mountView()
    await flushPromises()
    const editBtn = w.findAll('button').find((b) => b.text() === 'Bearbeiten')!
    await editBtn.trigger('click')
    expect(push).toHaveBeenCalledWith('/surveys/1/edit')
  })

  it('shows Remind only for PUBLISHED rows with non-responders and surfaces the notified count', async () => {
    const w = mountView()
    await flushPromises()
    const remindBtns = w.findAll('button').filter((b) => b.text().includes('erinnern'))
    expect(remindBtns).toHaveLength(1)
    await remindBtns[0]!.trigger('click')
    await flushPromises()
    expect(api.remindSurvey).toHaveBeenCalledWith('2')
    expect(w.text()).toContain('4 erinnert')
  })

  it('hides the Remind button when everyone has responded', async () => {
    api.surveys.mockResolvedValue({
      surveys: [
        { ...LIST.surveys[1], id: '3', responseCount: 12, eligibleCount: 12 },
      ],
    })
    const w = mountView()
    await flushPromises()
    const remindBtns = w.findAll('button').filter((b) => b.text().includes('erinnern'))
    expect(remindBtns).toHaveLength(0)
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

  it('confirms before deleting via a modal (no native confirm)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const w = mountView()
    await flushPromises()
    const delBtn = w.findAll('button').find((b) => b.text() === 'Löschen')!
    await delBtn.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Alle Antworten gehen verloren')
    const confirmBtn = w.findAll('button').filter((b) => b.text() === 'Löschen').at(-1)!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(api.deleteSurvey).toHaveBeenCalledWith('1')
    confirmSpy.mockRestore()
  })
})
