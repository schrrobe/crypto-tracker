import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CountBars from './CountBars.vue'

describe('CountBars', () => {
  it('shows empty state for no items', () => {
    const w = mount(CountBars, { props: { title: 'Test', items: [] } })
    expect(w.text()).toContain('Keine Daten')
  })

  it('scales bar widths relative to the max', () => {
    const w = mount(CountBars, {
      props: { title: 'Provider', items: [{ key: 'A', count: 10 }, { key: 'B', count: 5 }] },
    })
    expect(w.text()).toContain('A')
    expect(w.text()).toContain('B')
    const html = w.html()
    expect(html).toContain('width: 100%') // max → full width
    expect(html).toContain('width: 50%') // half of max
  })
})
