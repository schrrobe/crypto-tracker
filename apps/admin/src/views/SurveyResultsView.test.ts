import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 's1' } }) }))

// Capture the props passed to the Bar chart so we can assert on its config.
const barProps: { options?: Record<string, unknown> }[] = []
vi.mock('vue-chartjs', () => ({
  Bar: {
    props: ['data', 'options'],
    setup(props: { options: Record<string, unknown> }) {
      barProps.push({ options: props.options })
    },
    template: '<div data-stub="bar" />',
  },
}))

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
    barProps.length = 0
    api.surveyResults.mockReset().mockResolvedValue(RESULTS)
    api.surveyFreeText
      .mockReset()
      .mockResolvedValue({ answers: [{ text: 'Dark Mode', userId: 'abcd1234', createdAt: '2026-06-01T00:00:00.000Z' }], total: 1, page: 1, pageSize: 25 })
    api.surveyFreeTextCsv.mockReset().mockResolvedValue(undefined)
  })

  it('loads results on mount but NOT free-text answers', async () => {
    const w = mountView()
    await flushPromises()
    expect(api.surveyResults).toHaveBeenCalledWith('s1')
    expect(api.surveyFreeText).not.toHaveBeenCalled()
    expect(w.text()).toContain('Feature-Wunsch')
  })

  it('shows a loading skeleton while results are null', () => {
    api.surveyResults.mockReturnValue(new Promise(() => {}))
    const w = mountView()
    expect(w.find('.animate-pulse').exists()).toBe(true)
  })

  it('shows the response rate as a percentage with count / eligible and per-question answered count', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('35%')
    expect(w.text()).toContain('7 / 20')
    expect(w.text()).toContain('anonym')
    expect(w.text()).toContain('beantwortet von 7 von 7')
    expect(w.text()).toContain('beantwortet von 3 von 7')
  })

  it('configures the bar chart as a horizontal bar (indexAxis y)', async () => {
    mountView()
    await flushPromises()
    expect(barProps.length).toBeGreaterThan(0)
    expect(barProps[0]!.options?.indexAxis).toBe('y')
  })

  it('renders choice option counts in a table', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Rot')
    expect(w.text()).toContain('5')
    expect(w.text()).toContain('Blau')
  })

  it('collapses free-text behind a toggle and loads answers on expand', async () => {
    const w = mountView()
    await flushPromises()
    // toggle shows the count, answers not loaded yet
    const toggle = w.findAll('button').find((b) => b.text().includes('Antworten anzeigen'))!
    expect(toggle.text()).toContain('(1)')
    expect(api.surveyFreeText).not.toHaveBeenCalled()
    await toggle.trigger('click')
    await flushPromises()
    expect(api.surveyFreeText).toHaveBeenCalledWith('s1', { questionId: 'q-free', q: undefined, page: 1, pageSize: 25 })
    expect(w.text()).toContain('Dark Mode')
    // non-anonymous answer must NOT show a truncated user id
    expect(w.text()).not.toContain('abcd1234')
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
    await w.findAll('button').find((b) => b.text().includes('Antworten anzeigen'))!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Anon feedback')
    expect(w.text()).toContain('anonym')
  })

  it('triggers CSV export with an inline confirmation', async () => {
    const w = mountView()
    await flushPromises()
    await w.findAll('button').find((b) => b.text().includes('Antworten anzeigen'))!.trigger('click')
    await flushPromises()
    const csvBtn = w.findAll('button').find((b) => b.text().includes('CSV'))!
    await csvBtn.trigger('click')
    await flushPromises()
    expect(api.surveyFreeTextCsv).toHaveBeenCalledWith('s1', 'q-free')
    expect(w.text()).toContain('Export gestartet')
  })

  it('shows a zero-eligible warning banner when eligibleCount is 0', async () => {
    api.surveyResults.mockResolvedValue({ ...RESULTS, eligibleCount: 0, responseRate: 0 })
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('erreicht aktuell niemanden')
  })
})
