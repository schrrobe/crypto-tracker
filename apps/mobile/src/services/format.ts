// Anzeige-Formatierung — Berechnungen passieren ausschließlich im Backend (Decimal)

export function formatCurrency(value: string | null, currency: 'EUR' | 'USD'): string {
  if (value === null) return '–'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(value))
}

export function formatQuantity(quantity: string): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 8 }).format(Number(quantity))
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'noch nie'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  return new Date(iso).toLocaleDateString('de-DE')
}
