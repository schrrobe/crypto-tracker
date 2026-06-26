import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

vi.mock('../services/admin', () => ({ adminApi: { createSurvey: vi.fn() } }))

import { adminApi } from '../services/admin'
import SurveyBuilderView from './SurveyBuilderView.vue'

const api = adminApi as unknown as { createSurvey: ReturnType<typeof vi.fn> }

function mountView() {
  return mount(SurveyBuilderView)
}

describe('SurveyBuilderView', () => {
  beforeEach(() => {
    push.mockReset()
    api.createSurvey.mockReset().mockResolvedValue({ id: 'new' })
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
    // two option inputs appear (placeholder "Antwortoption")
    const optionInputs = w.findAll('input').filter((i) => i.attributes('placeholder') === 'Antwortoption')
    expect(optionInputs).toHaveLength(2)
  })

  it('saves a draft with the correct payload shape and navigates back', async () => {
    const w = mountView()
    // title
    const titleInput = w.findAll('input')[0]!
    await titleInput.setValue('Meine Umfrage')
    // make it a choice question + fill options
    await w.find('select').setValue('MULTI_CHOICE')
    await flushPromises()
    const optionInputs = w.findAll('input').filter((i) => i.attributes('placeholder') === 'Antwortoption')
    await optionInputs[0]!.setValue('A')
    await optionInputs[1]!.setValue('B')
    // fill the prompt
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

  it('includes anonymous flag and targeting in the payload', async () => {
    const w = mountView()
    await w.findAll('input:not([type])')[0]!.setValue('Zielgerichtet')
    // anonymous toggle
    const anonToggle = w.find('input[type="checkbox"]')
    await anonToggle.setValue(true)
    // plan multi-select: check FREE
    const freeCb = w.findAll('input[type="checkbox"]').find((i) => i.attributes('value') === 'FREE')!
    await freeCb.setValue(true)
    // currency tag input (comma-separated, upper-cased)
    const currencyInput = w.findAll('input').find((i) => i.attributes('placeholder') === 'z. B. EUR, USD')!
    await currencyInput.setValue('eur, usd')
    await currencyInput.trigger('keyup.enter')
    await flushPromises()
    expect(w.text()).toContain('EUR')
    expect(w.text()).toContain('USD')

    const saveBtn = w.findAll('button').find((b) => b.text() === 'Als Entwurf speichern')!
    await saveBtn.trigger('click')
    await flushPromises()

    const payload = api.createSurvey.mock.calls[0]![0]
    expect(payload.anonymous).toBe(true)
    expect(payload.targetPlans).toEqual(['FREE'])
    expect(payload.targetCurrencies).toEqual(['EUR', 'USD'])
  })
})
