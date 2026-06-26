import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// Capture the onIonViewWillEnter callback so the test can trigger the load.
let viewEnterCb: (() => unknown) | undefined
vi.mock('@ionic/vue', () => {
  const slotStub = { template: '<div><slot /></div>' }
  const names = [
    'IonPage', 'IonHeader', 'IonToolbar', 'IonButtons', 'IonBackButton', 'IonTitle',
    'IonContent', 'IonList', 'IonItem', 'IonItemDivider', 'IonLabel', 'IonNote', 'IonTextarea',
    'IonRadioGroup', 'IonRadio', 'IonCheckbox', 'IonButton', 'IonCard', 'IonCardContent', 'IonIcon',
    'IonProgressBar',
  ]
  const mod: Record<string, unknown> = {
    onIonViewWillEnter: (cb: () => unknown) => {
      viewEnterCb = cb
    },
  }
  for (const n of names) mod[n] = slotStub
  return mod
})

vi.mock('ionicons/icons', () => ({
  checkmarkCircleOutline: 'icon',
  lockClosedOutline: 'icon',
  documentTextOutline: 'icon',
  personCircleOutline: 'icon',
}))

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 's1' } }) }))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return { ...actual, useI18n: () => ({ t: (k: string) => k }) }
})

const getSurvey = vi.fn()
const submit = vi.fn()
vi.mock('../../stores/surveys.store', () => ({
  useSurveysStore: () => ({ getSurvey, submit, pending: [], reset: vi.fn() }),
}))

import SurveyPage from './SurveyPage.vue'
import { ApiError } from '../../services/api.client'

const SURVEY = {
  id: 's1',
  title: 'Feature-Wunsch',
  description: null,
  status: 'PUBLISHED',
  questions: [
    { id: 'q-free', type: 'FREE_TEXT', prompt: 'Sonstiges?', order: 0, options: [] },
    {
      id: 'q-single',
      type: 'SINGLE_CHOICE',
      prompt: 'Farbe?',
      order: 1,
      options: [{ id: 'o1', label: 'Rot', order: 0 }, { id: 'o2', label: 'Blau', order: 1 }],
    },
  ],
}

function mountPage() {
  return mount(SurveyPage, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { 'router-link': true, LoadingSkeleton: true },
    },
  })
}

describe('SurveyPage', () => {
  beforeEach(() => {
    viewEnterCb = undefined
    getSurvey.mockReset().mockResolvedValue(SURVEY)
    submit.mockReset().mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('loads and renders question prompts on view enter', async () => {
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    expect(getSurvey).toHaveBeenCalledWith('s1')
    expect(w.text()).toContain('Sonstiges?')
    expect(w.text()).toContain('Farbe?')
  })

  it('submits one answer per question with type-correct shape', async () => {
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()

    // Select the single-choice option so the submit guard lets it through.
    w.get('[data-testid="survey-single-group"]').trigger('ion-change', { detail: { value: 'o1' } })
    await flushPromises()

    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()

    expect(submit).toHaveBeenCalledTimes(1)
    const [id, payload] = submit.mock.calls[0]!
    expect(id).toBe('s1')
    expect(payload.answers).toHaveLength(2)
    const free = payload.answers.find((a: { questionId: string }) => a.questionId === 'q-free')
    const single = payload.answers.find((a: { questionId: string }) => a.questionId === 'q-single')
    // FREE_TEXT carries text (default empty), no optionIds; choice carries optionIds, no text
    expect(free).toEqual({ questionId: 'q-free', text: '', optionIds: undefined })
    expect(single).toEqual({ questionId: 'q-single', text: undefined, optionIds: ['o1'] })
  })

  it('shows a thank-you state after a successful submit', async () => {
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    w.get('[data-testid="survey-single-group"]').trigger('ion-change', { detail: { value: 'o1' } })
    await flushPromises()
    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="survey-thanks"]').exists()).toBe(true)
  })

  it('surfaces a submit error without losing the form', async () => {
    submit.mockRejectedValue(new Error('boom'))
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    w.get('[data-testid="survey-single-group"]').trigger('ion-change', { detail: { value: 'o1' } })
    await flushPromises()
    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="survey-submit-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="survey-thanks"]').exists()).toBe(false)
  })

  it('blocks submit with a gentle hint when no question is answered', async () => {
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()
    // gentle inline validation, no server call, form still present
    expect(w.find('[data-testid="survey-validation-error"]').exists()).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    expect(w.find('[data-testid="survey-thanks"]').exists()).toBe(false)
  })

  it('shows the identified note (not the lock note) for a non-anonymous survey', async () => {
    getSurvey.mockResolvedValue({ ...SURVEY, anonymous: false })
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    expect(w.find('[data-testid="survey-anonymous-badge"]').exists()).toBe(false)
    const identified = w.find('[data-testid="survey-identified-badge"]')
    expect(identified.exists()).toBe(true)
    expect(identified.text()).toContain('surveys.identifiedNote')
  })

  it('shows the anonymity badge (not the identified note) when the survey is anonymous', async () => {
    getSurvey.mockResolvedValue({ ...SURVEY, anonymous: true })
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    const badge = w.find('[data-testid="survey-anonymous-badge"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('surveys.anonymousNote')
    expect(w.find('[data-testid="survey-identified-badge"]').exists()).toBe(false)
  })

  it('shows the optional-questions hint near the progress bar', async () => {
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    const hint = w.find('[data-testid="survey-optional-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('surveys.optionalHint')
  })

  it('shows a friendly message when the survey was already submitted', async () => {
    submit.mockRejectedValue(new ApiError('SURVEY_ALREADY_SUBMITTED', 409, 'duplicate'))
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    w.get('[data-testid="survey-single-group"]').trigger('ion-change', { detail: { value: 'o1' } })
    await flushPromises()
    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()
    const err = w.find('[data-testid="survey-submit-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('surveys.alreadySubmitted')
    expect(w.find('[data-testid="survey-thanks"]').exists()).toBe(false)
  })

  it('shows a progress indicator that reflects answered questions', async () => {
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    const progress = w.find('[data-testid="survey-progress"]')
    expect(progress.exists()).toBe(true)
    expect(progress.text()).toContain('surveys.progress')

    // answering a question lets a previously-blocked submit go through,
    // proving the answered-count that drives the progress bar updates reactively
    w.get('[data-testid="survey-single-group"]').trigger('ion-change', { detail: { value: 'o1' } })
    await flushPromises()
    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('renders a tidy empty state when the survey has no questions', async () => {
    getSurvey.mockResolvedValue({ ...SURVEY, anonymous: false, questions: [] })
    const w = mountPage()
    await viewEnterCb?.()
    await flushPromises()
    expect(w.find('[data-testid="survey-empty"]').exists()).toBe(true)
    // no submit button / progress bar when there is nothing to answer
    expect(w.find('[data-testid="survey-submit"]').exists()).toBe(false)
    expect(w.find('[data-testid="survey-progress"]').exists()).toBe(false)
  })
})
