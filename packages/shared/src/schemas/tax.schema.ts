import { z } from 'zod'
import type { SourceType } from '../enums'

// Steuerreport: Deutschland (§23 EStG) und Österreich (§27b EStG / Alt-/Neuvermögen)

export const TAX_COUNTRIES = ['DE', 'AT'] as const
export type TaxCountry = (typeof TAX_COUNTRIES)[number]

export const taxReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2009).max(2100),
  country: z.enum(TAX_COUNTRIES),
})
export type TaxReportQuery = z.infer<typeof taxReportQuerySchema>

// Stabile Warnungs-Codes — das Frontend lokalisiert über tax.warnings.<code>
export const TaxWarningCode = {
  // DEPOSIT ohne Kurs: Lot mit Kostenbasis 0 angesetzt (steuerlich konservativ)
  UNKNOWN_ACQUISITION_BASIS: 'UNKNOWN_ACQUISITION_BASIS',
  // SELL ohne Kurs (auch nach Backfill): Erlös 0, Position unvollständig
  MISSING_DISPOSAL_PRICE: 'MISSING_DISPOSAL_PRICE',
  // Mehr verkauft als angeschafft: ungedeckter Anteil mit Basis 0, steuerpflichtig
  SOLD_MORE_THAN_ACQUIRED: 'SOLD_MORE_THAN_ACQUIRED',
  // WITHDRAWAL hat Lots aus der Verfolgung entfernt (kein steuerbarer Vorgang)
  WITHDRAWAL_REMOVED_LOTS: 'WITHDRAWAL_REMOVED_LOTS',
  // TRANSFER/OTHER-Transaktionen werden ignoriert
  TRANSFERS_IGNORED: 'TRANSFERS_IGNORED',
  // Kurs in Fremdwährung (≠ EUR) verworfen — keine FX-Umrechnung in V1
  FOREIGN_CURRENCY_PRICE_IGNORED: 'FOREIGN_CURRENCY_PRICE_IGNORED',
  // CoinGecko-Lookup-Limit pro Lauf erreicht — erneut ausführen trifft den Cache
  PRICE_LOOKUP_LIMIT_REACHED: 'PRICE_LOOKUP_LIMIT_REACHED',
} as const
export type TaxWarningCode = (typeof TaxWarningCode)[keyof typeof TaxWarningCode]

export type TaxRegime = 'DE_PRIVATE_SALE' | 'AT_ALTVERMOEGEN' | 'AT_NEUVERMOEGEN'
export type TaxPriceQuality = 'ORIGINAL' | 'BACKFILLED' | 'MISSING'

export interface TaxDisposalDto {
  assetSymbol: string
  assetName: string
  // null = Anschaffung unbekannt (Oversell) → wie ≤ 1 Jahr behandelt
  acquiredAt: string | null
  disposedAt: string
  quantity: string
  costBasisEur: string
  proceedsEur: string
  gainEur: string
  taxable: boolean
  regime: TaxRegime
  priceQuality: TaxPriceQuality
}

export interface TaxReportTotalsDto {
  totalGainEur: string
  taxFreeGainEur: string
  taxableGainEur: string
  // Freigrenze (DE: 600/1000 je nach Jahr; AT: 440 nur Altvermögen); null wenn nicht anwendbar
  thresholdEur: string | null
  // true = Freigrenze überschritten → voller Betrag steuerpflichtig
  thresholdApplied: boolean
  taxableAfterThresholdEur: string
  // nur AT: Neuvermögen-Topf (27,5 % Sondersteuersatz), separat vom Altvermögen
  atNeuvermoegenGainEur?: string
}

export interface TaxWarningDto {
  code: TaxWarningCode
  assetSymbol?: string
  count?: number
}

export interface TaxUncoveredSourceDto {
  id: string
  label: string
  type: SourceType
}

export interface TaxReportDto {
  year: number
  country: TaxCountry
  currency: 'EUR'
  disposals: TaxDisposalDto[]
  totals: TaxReportTotalsDto
  warnings: TaxWarningDto[]
  // Quellen mit Beständen, aber ohne Transaktionshistorie — nicht im Report enthalten
  uncoveredSources: TaxUncoveredSourceDto[]
  generatedAt: string
}
