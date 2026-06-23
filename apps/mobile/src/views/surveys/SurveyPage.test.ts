import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// Capture the onIonViewWillEnter callback so the test can trigger the load.
let viewEnterCb: (() => unknown) | undefined
vi.mock('@ionic/vue', () => {
  const slotStub = { template: '<div><slot /></div>' }
  const names = [
    'IonPage', 'IonHeader', 'IonToolbar', 'IonButtons', 'IonBackButton', 'IonTitle',
    'IonContent', 'IonList', 'IonItem', 'IonItemDivider', 'IonLabel', 'IonTextarea',
    'IonRadioGroup', 'IonRadio', 'IonCheckbox', 'IonButton', 'IonCard', 'IonCardContent', 'IonIcon',
  ]
  const mod: Record<string, unknown> = {
    onIonViewWillEnter: (cb: () => unknown) => {
      viewEnterCb = cb
    },
  }
  for (const n of names) mod[n] = slotStub
  return mod
})

vi.mock('ionicons/icons', () => ({ checkmarkCircleOutline: 'icon' }))

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 's1' } }) }))

const getSurvey = vi.fn()
const submit = vi.fn()
vi.mock('../../stores/surveys.store', () => ({
  useSurveysStore: () => ({ getSurvey, submit, pending: [], reset: vi.fn() }),
}))

import SurveyPage from './SurveyPage.vue'

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
    expect(single).toEqual({ questionId: 'q-single', text: undefined, optionIds: [] })
  })

  it('shows a thank-you state after a successful submit', async () => {
    const w = mountPage()
    await viewEnterCb?.()
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
    await w.get('[data-testid="survey-submit"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="survey-submit-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="survey-thanks"]').exists()).toBe(false)
  })
})
