import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 's1' } }) }))

// Stub the chart so we don't pull Chart.js into the test.
vi.mock('vue-chartjs', () => ({ Bar: { template: '<div data-stub="bar" />' } }))

vi.mock('../services/admin', () => ({
  adminApi: { surveyResults: vi.fn(), surveyFreeText: vi.fn(), surveyFreeTextCsv: vi.fn() },
}))

import { adminApi } from '../services/admin'
import SurveyResultsView from './SurveyResultsView.vue'

const api = adminApi as unknown as {
  surveyResults: ReturnType<typeof vi.fn>
  surveyFreeText: ReturnType<typeof vi.fn>
  surveyFreeTextCsv: ReturnType<typeof vi.fn>
}

const RESULTS = {
  id: 's1',
  title: 'Feature-Wunsch',
  status: 'PUBLISHED',
  anonymous: true,
  responseCount: 7,
  eligibleCount: 20,
  responseRate: 0.35,
  questions: [
    {
      questionId: 'q-choice',
      type: 'SINGLE_CHOICE',
      prompt: 'Farbe?',
      answeredCount: 7,
      options: [
        { optionId: 'o1', label: 'Rot', count: 5 },
        { optionId: 'o2', label: 'Blau', count: 2 },
      ],
      freeTextCount: 0,
    },
    { questionId: 'q-free', type: 'FREE_TEXT', prompt: 'Sonstiges?', answeredCount: 3, options: [], freeTextCount: 1 },
  ],
}

function mountView() {
  return mount(SurveyResultsView, {
    global: { mocks: { $router: { push: vi.fn() } }, stubs: { 'router-link': true } },
  })
}

describe('SurveyResultsView', () => {
  beforeEach(() => {
    api.surveyResults.mockReset().mockResolvedValue(RESULTS)
    api.surveyFreeText
      .mockReset()
      .mockResolvedValue({ answers: [{ text: 'Dark Mode', userId: 'abcd1234', createdAt: '2026-06-01T00:00:00.000Z' }], total: 1, page: 1, pageSize: 25 })
    api.surveyFreeTextCsv.mockReset().mockResolvedValue(undefined)
  })

  it('loads results and the free-text list on mount', async () => {
    const w = mountView()
    await flushPromises()
    expect(api.surveyResults).toHaveBeenCalledWith('s1')
    expect(api.surveyFreeText).toHaveBeenCalledWith('s1', { questionId: 'q-free', q: undefined, page: 1, pageSize: 25 })
    expect(w.text()).toContain('Feature-Wunsch')
  })

  it('shows the response rate as a percentage with count / eligible and per-question answered count', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('35%')
    expect(w.text()).toContain('7 / 20')
    // anonymity indicator on the survey
    expect(w.text()).toContain('anonym')
    // per-question answered count "beantwortet von N von {responseCount}"
    expect(w.text()).toContain('beantwortet von 7 von 7')
    expect(w.text()).toContain('beantwortet von 3 von 7')
  })

  it('shows an anonymous indicator instead of a user id when userId is null', async () => {
    api.surveyFreeText.mockResolvedValue({
      answers: [{ text: 'Anon feedback', userId: null, createdAt: '2026-06-01T00:00:00.000Z' }],
      total: 1,
      page: 1,
      pageSize: 25,
    })
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Anon feedback')
    expect(w.text()).toContain('anonym')
  })

  it('renders choice option counts in a table', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Rot')
    expect(w.text()).toContain('5')
    expect(w.text()).toContain('Blau')
  })

  it('renders free-text answers and triggers CSV export', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Dark Mode')
    const csvBtn = w.findAll('button').find((b) => b.text().includes('CSV'))!
    await csvBtn.trigger('click')
    expect(api.surveyFreeTextCsv).toHaveBeenCalledWith('s1', 'q-free')
  })
})
