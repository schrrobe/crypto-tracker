import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import KpiCard from './KpiCard.vue'

describe('KpiCard', () => {
  it('renders label, value and sub', () => {
    const w = mount(KpiCard, { props: { label: 'Nutzer', value: 42, sub: '12 Pro' } })
    expect(w.text()).toContain('Nutzer')
    expect(w.text()).toContain('42')
    expect(w.text()).toContain('12 Pro')
  })

  it('shows ▲ + green for positive delta', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1, delta: 12 } })
    expect(w.text()).toContain('▲')
    expect(w.text()).toContain('12%')
    expect(w.html()).toContain('text-emerald-600')
  })

  it('shows ▼ + red for negative delta', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1, delta: -5 } })
    expect(w.text()).toContain('▼')
    expect(w.text()).toContain('5%')
    expect(w.html()).toContain('text-red-600')
  })

  it('renders "neu" for null delta (previous period was 0), no arrow', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1, delta: null } })
    expect(w.text()).toContain('neu')
    expect(w.text()).not.toContain('▲')
    expect(w.text()).not.toContain('▼')
  })

  it('renders nothing delta-ish when delta is undefined', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1 } })
    expect(w.text()).not.toContain('▲')
    expect(w.text()).not.toContain('▼')
    expect(w.text()).not.toContain('neu')
  })

  it('zero delta is neutral (gray, no arrow)', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1, delta: 0 } })
    expect(w.text()).toContain('0%')
    expect(w.text()).not.toContain('▲')
    expect(w.text()).not.toContain('▼')
    expect(w.html()).toContain('text-slate-500')
  })

  it('polarity up-bad flips colours: positive delta red, negative green', () => {
    const up = mount(KpiCard, { props: { label: 'x', value: 1, delta: 10, polarity: 'up-bad' } })
    expect(up.text()).toContain('▲')
    expect(up.html()).toContain('text-red-600')
    const down = mount(KpiCard, { props: { label: 'x', value: 1, delta: -10, polarity: 'up-bad' } })
    expect(down.text()).toContain('▼')
    expect(down.html()).toContain('text-emerald-600')
  })
})
