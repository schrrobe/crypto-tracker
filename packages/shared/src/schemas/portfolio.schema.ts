import { z } from 'zod'
import type { HoldingAccountType, PositionSide, ProviderId, SourceType } from '../enums'

// Quantities flow through the API as strings — never as float (Decimal precision)
export const quantityString = z
  .string()
  .regex(/^\d{1,20}([.,]\d{1,18})?$/, 'Ungültige Menge')
  .transform((v) => v.replace(',', '.'))
  .refine((v) => Number(v) > 0, 'Menge muss größer 0 sein')

export const createManualSourceSchema = z.object({
  type: z.literal('MANUAL'),
  label: z.string().trim().min(1).max(60),
  portfolioId: z.string().uuid().optional(),
})

export const EXCHANGE_PROVIDERS = [
  'COINBASE', 'KRAKEN', 'BITVAVO', 'BITPANDA',
  'BINANCE', 'OKX', 'BYBIT', 'KUCOIN', 'BITSTAMP', 'GATEIO', 'CRYPTOCOM',
] as const
// OKX and KuCoin require an API passphrase
export const PASSPHRASE_REQUIRED_PROVIDERS = ['OKX', 'KUCOIN'] as const
export const WALLET_PROVIDERS = [
  'BITCOIN', 'SOLANA', 'ETHEREUM',
  'POLYGON', 'ARBITRUM', 'BASE', 'BSC',
  'LITECOIN', 'DOGECOIN', 'CARDANO', 'XRP', 'TRON', 'COSMOS',
] as const

export const createExchangeSourceSchema = z.object({
  type: z.literal('EXCHANGE'),
  provider: z.enum(EXCHANGE_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(4).max(500),
  // optional: Bitpanda needs no secret; Coinbase CDP keys are PEM (multi-line, long)
  apiSecret: z.string().trim().min(4).max(2000).optional(),
  passphrase: z.string().trim().max(200).optional(),
  portfolioId: z.string().uuid().optional(),
})

export const createWalletSourceSchema = z.object({
  type: z.literal('WALLET'),
  provider: z.enum(WALLET_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(10).max(120),
  // Dust/spam filter: skip unknown tokens (Solana mints without mapping) by default
  includeUnknownTokens: z.boolean().default(false),
  portfolioId: z.string().uuid().optional(),
})

export const createSourceSchema = z
  .discriminatedUnion('type', [
    createManualSourceSchema,
    createExchangeSourceSchema,
    createWalletSourceSchema,
  ])
  // Bitpanda is the only exchange without a secret; OKX/KuCoin require a passphrase
  .superRefine((value, ctx) => {
    if (value.type !== 'EXCHANGE') return
    if (value.provider !== 'BITPANDA' && !value.apiSecret) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['apiSecret'], message: 'API-Secret fehlt' })
    }
    if ((PASSPHRASE_REQUIRED_PROVIDERS as readonly string[]).includes(value.provider) && !value.passphrase) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['passphrase'], message: 'Passphrase fehlt' })
    }
  })
export type CreateSourceInput = z.infer<typeof createSourceSchema>

export const updateSourceSchema = z.object({
  label: z.string().trim().min(1).max(60),
})

export const upsertHoldingSchema = z.object({
  assetId: z.string().uuid(),
  quantity: quantityString,
})

export const updateHoldingSchema = z.object({
  quantity: quantityString,
})

export interface AssetDto {
  id: string
  symbol: string
  name: string
  coingeckoId: string | null
  iconUrl: string | null
}

export interface HoldingDto {
  id: string
  sourceId: string
  sourceLabel: string
  sourceType: SourceType
  // SPOT/EARN/MARGIN/FUTURES — quantity/valueEur can be negative for MARGIN
  accountType: HoldingAccountType
  asset: AssetDto
  quantity: string
  valueEur: string | null
  valueUsd: string | null
}

export interface FuturesPositionDto {
  id: string
  sourceId: string
  sourceLabel: string
  assetSymbol: string
  rawSymbol: string
  side: PositionSide
  size: string
  entryPrice: string | null
  markPrice: string | null
  leverage: number | null
  // uPnL in quoteCurrency, as reported by the exchange
  unrealizedPnl: string | null
  quoteCurrency: string | null
  // uPnL in EUR (via stablecoin price); null if no price is available
  unrealizedPnlEur: string | null
  // Notional = size × markPrice in EUR
  valueEur: string | null
  liquidationPrice: string | null
}

export interface SyncRunDto {
  id: string
  status: 'RUNNING' | 'SUCCESS' | 'ERROR'
  startedAt: string
  finishedAt: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface SourceDto {
  id: string
  type: SourceType
  provider: ProviderId
  label: string
  lastSyncAt: string | null
  createdAt: string
  // only for EXCHANGE: masked key (…1234) — never the key/secret itself
  keyPreview: string | null
  // only for WALLET
  address: string | null
  chain: string | null
  includeUnknownTokens: boolean | null
  lastSyncRun: SyncRunDto | null
}

export interface PortfolioAssetPosition {
  asset: AssetDto
  quantity: string
  valueEur: string | null
  valueUsd: string | null
}

export const confirmMappingSchema = z.object({
  mapping: z.object({
    symbol: z.string().min(1),
    quantity: z.string().min(1),
    // required when kind=TRANSACTIONS — the service checks this contextually
    type: z.string().min(1).optional(),
    timestamp: z.string().min(1).optional(),
    price: z.string().min(1).optional(),
    fee: z.string().min(1).optional(),
    currency: z.string().min(1).optional(),
  }),
})
export type ConfirmMappingInput = z.infer<typeof confirmMappingSchema>

export interface MappingSuggestionDto {
  symbol: string | null
  quantity: string | null
  type: string | null
  timestamp: string | null
  price: string | null
  fee: string | null
  currency: string | null
}

export interface ImportErrorRow {
  line: number
  raw: string
  error: string
}

export interface CsvImportDto {
  id: string
  sourceId: string
  sourceLabel: string
  filename: string
  kind: 'BALANCES' | 'TRANSACTIONS'
  status: 'PENDING_MAPPING' | 'COMPLETED' | 'FAILED'
  totalRows: number
  importedRows: number
  errorRows: ImportErrorRow[]
  createdAt: string
}

export interface CsvUploadResponse {
  import: CsvImportDto
  headers: string[]
  preview: Array<Record<string, string>>
  suggestedMapping: MappingSuggestionDto
  // detected export format (columns are then fully pre-filled)
  preset: 'KRAKEN' | 'BITPANDA' | null
  // active duplicate detection: label of a source already connected via API for
  // the same exchange (detected via preset or chosen at upload) in the same
  // portfolio — otherwise null. Warns about double counting (API balance + CSV balance).
  duplicateExchangeSource: string | null
  // provider of the detected duplicate exchange — used to display the name in the
  // warning (covers all exchanges, not just the preset ones).
  duplicateExchangeProvider: (typeof EXCHANGE_PROVIDERS)[number] | null
  // label of an earlier CSV import with identical file content in the same
  // portfolio — otherwise null. Warns about double counting the same file.
  duplicateCsvSource: string | null
}

export type HistoryRange = '24h' | '7d' | '30d' | '1y'

// Unrealized profit/loss (Pro) — cost basis from the tax engine's FIFO, EUR.
export interface PnlPositionDto {
  sourceId: string
  sourceLabel: string
  assetSymbol: string
  assetName: string
  quantity: string
  costBasisEur: string
  valueEur: string
  pnlEur: string
  pnlPct: number
}

export interface PortfolioPnlDto {
  totalCostBasisEur: string
  totalValueEur: string
  totalPnlEur: string
  totalPnlPct: number
  positions: PnlPositionDto[]
}

export interface PortfolioHistoryPoint {
  t: string // ISO timestamp
  value: string
}

export interface PortfolioHistoryDto {
  range: HistoryRange
  currency: 'EUR' | 'USD'
  points: PortfolioHistoryPoint[]
  // number of assets not included in the history due to missing mapping/Top-N
  excludedAssets: number
}

export interface AccountTypeBreakdown {
  accountType: HoldingAccountType
  valueEur: string
  valueUsd: string
}

export interface PortfolioSummaryDto {
  totalEur: string
  totalUsd: string
  pricesFetchedAt: string | null
  byAsset: PortfolioAssetPosition[]
  // signed values per account type (MARGIN possibly negative)
  byAccountType: AccountTypeBreakdown[]
  // unrealized futures PnL, NOT included in totalEur
  futuresUnrealizedPnlEur: string | null
  futuresUnrealizedPnlUsd: string | null
  unmappedAssets: AssetDto[]
}
