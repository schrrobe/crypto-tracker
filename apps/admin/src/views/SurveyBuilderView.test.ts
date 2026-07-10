import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const push = vi.fn()
let routeParams: Record<string, string> = {}
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: routeParams }),
}))

vi.mock('../services/admin', () => ({
  adminApi: {
    createSurvey: vi.fn(),
    updateSurvey: vi.fn(),
    survey: vi.fn(),
    surveyAudience: vi.fn(),
  },
}))

import { adminApi } from '../services/admin'
import SurveyBuilderView from './SurveyBuilderView.vue'

const api = adminApi as unknown as {
  createSurvey: ReturnType<typeof vi.fn>
  updateSurvey: ReturnType<typeof vi.fn>
  survey: ReturnType<typeof vi.fn>
  surveyAudience: ReturnType<typeof vi.fn>
}

function mountView() {
  return mount(SurveyBuilderView)
}

describe('SurveyBuilderView', () => {
  beforeEach(() => {
    push.mockReset()
    routeParams = {}
    api.createSurvey.mockReset().mockResolvedValue({ id: 'new' })
    api.updateSurvey.mockReset().mockResolvedValue(undefined)
    api.survey.mockReset()
    api.surveyAudience.mockReset().mockResolvedValue({ count: 42 })
  })

  it('starts with one free-text question and no options', () => {
    const w = mountView()
    const selects = w.findAll('select')
    expect(selects).toHaveLength(1)
    expect((selects[0]!.element as HTMLSelectElement).value).toBe('FREE_TEXT')
    expect(w.text()).not.toContain('+ Option')
  })

  it('seeds two option rows when a question becomes a choice type', async () => {
    const w = mountView()
    await w.find('select').setValue('SINGLE_CHOICE')
    await flushPromises()
    expect(w.text()).toContain('+ Option')
    const optionInputs = w.findAll('input').filter((i) => i.attributes('placeholder') === 'Antwortoption')
    expect(optionInputs).toHaveLength(2)
  })

  it('saves a draft with the correct payload shape and navigates back', async () => {
    const w = mountView()
    const titleInput = w.findAll('input')[0]!
    await titleInput.setValue('Meine Umfrage')
    await w.find('select').setValue('MULTI_CHOICE')
    await flushPromises()
    const optionInputs = w.findAll('input').filter((i) => i.attributes('placeholder') === 'Antwortoption')
    await optionInputs[0]!.setValue('A')
    await optionInputs[1]!.setValue('B')
    const promptInput = w.findAll('input').find((i) => i.attributes('placeholder') === 'Fragetext')!
    await promptInput.setValue('Welche?')

    const saveBtn = w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')!
    await saveBtn.trigger('click')
    await flushPromises()

    expect(api.createSurvey).toHaveBeenCalledTimes(1)
    const payload = api.createSurvey.mock.calls[0]![0]
    expect(payload.title).toBe('Meine Umfrage')
    expect(payload.anonymous).toBe(false)
    expect(payload.targetPlans).toEqual([])
    expect(payload.targetCurrencies).toEqual([])
    expect(payload.questions).toHaveLength(1)
    expect(payload.questions[0]).toMatchObject({
      type: 'MULTI_CHOICE',
      prompt: 'Welche?',
      options: [{ label: 'A' }, { label: 'B' }],
    })
    expect(push).toHaveBeenCalledWith('/surveys')
  })

  it('blocks save with inline errors when the title is empty', async () => {
    const w = mountView()
    // prompt filled but no title
    const promptInput = w.findAll('input').find((i) => i.attributes('placeholder') === 'Fragetext')!
    await promptInput.setValue('Etwas')
    const saveBtn = w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')!
    await saveBtn.trigger('click')
    await flushPromises()
    expect(api.createSurvey).not.toHaveBeenCalled()
    expect(w.text()).toContain('Titel darf nicht leer sein')
  })

  it('blocks save when a choice question has fewer than 2 option labels', async () => {
    const w = mountView()
    await w.findAll('input')[0]!.setValue('Titel da')
    await w.find('select').setValue('SINGLE_CHOICE')
    await flushPromises()
    const promptInput = w.findAll('input').find((i) => i.attributes('placeholder') === 'Fragetext')!
    await promptInput.setValue('Frage?')
    const optionInputs = w.findAll('input').filter((i) => i.attributes('placeholder') === 'Antwortoption')
    await optionInputs[0]!.setValue('Nur eine')
    // second option left empty
    const saveBtn = w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')!
    await saveBtn.trigger('click')
    await flushPromises()
    expect(api.createSurvey).not.toHaveBeenCalled()
    expect(w.text()).toContain('mindestens 2')
  })

  it('includes anonymous flag and EUR/USD currency checkboxes in the payload', async () => {
    const w = mountView()
    await w.findAll('input:not([type])')[0]!.setValue('Zielgerichtet')
    const promptInput = w.findAll('input').find((i) => i.attributes('placeholder') === 'Fragetext')!
    await promptInput.setValue('Frage?')
    // anonymous toggle (first checkbox)
    await w.find('input[type="checkbox"]').setValue(true)
    // plan FREE
    const freeCb = w.findAll('input[type="checkbox"]').find((i) => i.attributes('value') === 'FREE')!
    await freeCb.setValue(true)
    // currency checkboxes EUR + USD
    const eurCb = w.findAll('input[type="checkbox"]').find((i) => i.attributes('value') === 'EUR')!
    const usdCb = w.findAll('input[type="checkbox"]').find((i) => i.attributes('value') === 'USD')!
    await eurCb.setValue(true)
    await usdCb.setValue(true)

    const saveBtn = w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')!
    await saveBtn.trigger('click')
    await flushPromises()

    const payload = api.createSurvey.mock.calls[0]![0]
    expect(payload.anonymous).toBe(true)
    expect(payload.targetPlans).toEqual(['FREE'])
    expect(payload.targetCurrencies).toEqual(['EUR', 'USD'])
  })

  it('calls surveyAudience when targeting changes and shows the count', async () => {
    api.surveyAudience.mockResolvedValue({ count: 7 })
    const w = mountView()
    await flushPromises()
    const proCb = w.findAll('input[type="checkbox"]').find((i) => i.attributes('value') === 'PRO')!
    await proCb.setValue(true)
    // debounce 300ms
    await new Promise((r) => setTimeout(r, 350))
    await flushPromises()
    expect(api.surveyAudience).toHaveBeenCalledWith(['PRO'], [])
    expect(w.text()).toContain('Erreicht aktuell ~7 Nutzer')
  })

  it('loads an existing draft in edit mode and saves via updateSurvey (PATCH)', async () => {
    routeParams = { id: 'draft-1' }
    api.survey.mockResolvedValue({
      id: 'draft-1',
      title: 'Bestehender Entwurf',
      description: 'desc',
      status: 'DRAFT',
      anonymous: true,
      targetPlans: ['PRO'],
      targetCurrencies: ['USD'],
      questions: [{ type: 'FREE_TEXT', prompt: 'Vorhandene Frage', options: [] }],
    })
    const w = mountView()
    await flushPromises()
    expect(api.survey).toHaveBeenCalledWith('draft-1')
    expect(w.text()).toContain('Umfrage bearbeiten')
    expect((w.findAll('input')[0]!.element as HTMLInputElement).value).toBe('Bestehender Entwurf')

    const saveBtn = w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')!
    await saveBtn.trigger('click')
    await flushPromises()
    expect(api.updateSurvey).toHaveBeenCalledTimes(1)
    expect(api.updateSurvey.mock.calls[0]![0]).toBe('draft-1')
    expect(api.createSurvey).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/surveys')
  })

  it('shows a not-editable notice for non-draft surveys', async () => {
    routeParams = { id: 'pub-1' }
    api.survey.mockResolvedValue({
      id: 'pub-1',
      title: 'Live',
      description: null,
      status: 'PUBLISHED',
      anonymous: false,
      targetPlans: [],
      targetCurrencies: [],
      questions: [],
    })
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Nur Entwürfe können bearbeitet werden')
    expect(w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')).toBeUndefined()
  })
})
