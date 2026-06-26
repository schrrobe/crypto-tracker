import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from './ConfirmDialog.vue'

describe('ConfirmDialog', () => {
  it('renders title, message and confirm label', () => {
    const w = mount(ConfirmDialog, {
      props: { title: 'Wirklich?', message: 'Das geht nicht zurück.', confirmLabel: 'Ja, los' },
    })
    expect(w.text()).toContain('Wirklich?')
    expect(w.text()).toContain('Das geht nicht zurück.')
    expect(w.text()).toContain('Ja, los')
    expect(w.text()).toContain('Abbrechen')
  })

  it('emits confirm when the confirm button is clicked', async () => {
    const w = mount(ConfirmDialog, { props: { title: 't', confirmLabel: 'OK' } })
    await w.findAll('button').find((b) => b.text() === 'OK')!.trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
  })

  it('emits cancel when the cancel button is clicked', async () => {
    const w = mount(ConfirmDialog, { props: { title: 't', confirmLabel: 'OK' } })
    await w.findAll('button').find((b) => b.text() === 'Abbrechen')!.trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })

  it('applies danger styling when danger is true', () => {
    const w = mount(ConfirmDialog, { props: { title: 't', confirmLabel: 'Löschen', danger: true } })
    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Löschen')!
    expect(confirmBtn.classes().join(' ')).toContain('bg-red-600')
  })

  it('renders slot content over the message prop', () => {
    const w = mount(ConfirmDialog, {
      props: { title: 't', confirmLabel: 'OK' },
      slots: { default: '<p>Custom body</p>' },
    })
    expect(w.text()).toContain('Custom body')
  })
})
