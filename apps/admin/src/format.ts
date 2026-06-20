export function money(cents: number, currency = 'EUR'): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

export function date(iso: string | null): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('de-DE')
}

// Render a per-currency earnings list ("10.00 EUR · 2.00 USD"); '–' when empty.
export function earnings(
  list: { currency: string; owedCents: number; paidCents: number }[],
  field: 'owedCents' | 'paidCents',
): string {
  if (!list.length) return '–'
  return list.map((e) => money(e[field], e.currency)).join(' · ')
}
