export function money(cents: number, currency = 'EUR'): string {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

export function date(iso: string | null): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('de-DE')
}
