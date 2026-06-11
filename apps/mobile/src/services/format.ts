// Anzeige-Formatierung — Berechnungen passieren ausschließlich im Backend (Decimal).
// Formate folgen der gewählten App-Sprache.
import { intlLocale, t } from '../i18n'

export { intlLocale }

export function formatCurrency(value: string | null, currency: 'EUR' | 'USD'): string {
  if (value === null) return '–'
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(Number(value))
}

export function formatQuantity(quantity: string): string {
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 8 }).format(Number(quantity))
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return t('relative.never')
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return t('relative.justNow')
  if (minutes < 60) return t('relative.minutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('relative.hoursAgo', { n: hours })
  return new Date(iso).toLocaleDateString(intlLocale())
}
