import { z } from 'zod'
import type { SourceType } from '../enums'

// Tax report: Germany (§23 EStG) and Austria (§27b EStG / Altvermögen/Neuvermögen)

export const TAX_COUNTRIES = ['DE', 'AT'] as const
export type TaxCountry = (typeof TAX_COUNTRIES)[number]

export const taxReportQuerySchema = z.object({
  year: z.coerce.number().int().min(2009).max(2100),
  country: z.enum(TAX_COUNTRIES),
  portfolioId: z.string().uuid().optional(),
})
export type TaxReportQuery = z.infer<typeof taxReportQuerySchema>

// Stable warning codes — the frontend localizes via tax.warnings.<code>
export const TaxWarningCode = {
  // DEPOSIT without price: lot booked with cost basis 0 (tax-conservative)
  UNKNOWN_ACQUISITION_BASIS: 'UNKNOWN_ACQUISITION_BASIS',
  // SELL without price (even after backfill): proceeds 0, position incomplete
  MISSING_DISPOSAL_PRICE: 'MISSING_DISPOSAL_PRICE',
  // Sold more than acquired: uncovered portion with basis 0, taxable
  SOLD_MORE_THAN_ACQUIRED: 'SOLD_MORE_THAN_ACQUIRED',
  // WITHDRAWAL removed lots from tracking (not a taxable event)
  WITHDRAWAL_REMOVED_LOTS: 'WITHDRAWAL_REMOVED_LOTS',
  // TRANSFER/OTHER transactions are ignored
  TRANSFERS_IGNORED: 'TRANSFERS_IGNORED',
  // Price in foreign currency (≠ EUR) discarded — no FX conversion in V1
  FOREIGN_CURRENCY_PRICE_IGNORED: 'FOREIGN_CURRENCY_PRICE_IGNORED',
  // CoinGecko lookup limit per run reached — re-running hits the cache
  PRICE_LOOKUP_LIMIT_REACHED: 'PRICE_LOOKUP_LIMIT_REACHED',
  // Wallet source has only automatically imported staking rewards —
  // buys/sells of this source are missing from the report
  WALLET_REWARDS_ONLY: 'WALLET_REWARDS_ONLY',
  // AT: crypto-to-crypto swap is tax-deferred — cost basis carries over
  SWAP_DEFERRED: 'SWAP_DEFERRED',
} as const
export type TaxWarningCode = (typeof TaxWarningCode)[keyof typeof TaxWarningCode]

export type TaxRegime = 'DE_PRIVATE_SALE' | 'AT_ALTVERMOEGEN' | 'AT_NEUVERMOEGEN'
export type TaxPriceQuality = 'ORIGINAL' | 'BACKFILLED' | 'MISSING'

export interface TaxDisposalDto {
  assetSymbol: string
  assetName: string
  // null = acquisition unknown (oversell) → treated like ≤ 1 year
  acquiredAt: string | null
  disposedAt: string
  quantity: string
  costBasisEur: string
  proceedsEur: string
  gainEur: string
  taxable: boolean
  regime: TaxRegime
  priceQuality: TaxPriceQuality
  // source of the disposal — relevant since wallet-scoped FIFO (DE)
  sourceLabel?: string
}

export interface TaxReportTotalsDto {
  totalGainEur: string
  taxFreeGainEur: string
  taxableGainEur: string
  // exemption limit (DE: 600/1000 depending on year; AT: 440 only Altvermögen); null if not applicable
  thresholdEur: string | null
  // true = exemption limit exceeded → full amount taxable
  thresholdApplied: boolean
  taxableAfterThresholdEur: string
  // AT only: Neuvermögen pool (27.5 % special tax rate), separate from Altvermögen
  atNeuvermoegenGainEur?: string
  // DE only: staking inflows as other income (§22 Nr. 3 EStG, exemption limit 256 €)
  stakingIncomeEur?: string
  stakingThresholdEur?: string
  stakingTaxableEur?: string
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
  // sources with balances but without transaction history — not included in the report
  uncoveredSources: TaxUncoveredSourceDto[]
  generatedAt: string
}
