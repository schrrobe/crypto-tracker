import { z } from 'zod'
import type { ProviderId, SourceType } from '../enums'

// Mengen laufen als String durch die API — nie als float (Decimal-Präzision)
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
// OKX und KuCoin verlangen zwingend eine API-Passphrase
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
  // optional: Bitpanda braucht kein Secret; Coinbase-CDP-Keys sind PEM (mehrzeilig, lang)
  apiSecret: z.string().trim().min(4).max(2000).optional(),
  passphrase: z.string().trim().max(200).optional(),
  portfolioId: z.string().uuid().optional(),
})

export const createWalletSourceSchema = z.object({
  type: z.literal('WALLET'),
  provider: z.enum(WALLET_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(10).max(120),
  // Dust-/Spam-Filter: unbekannte Tokens (Solana-Mints ohne Mapping) standardmäßig überspringen
  includeUnknownTokens: z.boolean().default(false),
  portfolioId: z.string().uuid().optional(),
})

export const createSourceSchema = z
  .discriminatedUnion('type', [
    createManualSourceSchema,
    createExchangeSourceSchema,
    createWalletSourceSchema,
  ])
  // Bitpanda ist der einzige Exchange ohne Secret; OKX/KuCoin verlangen eine Passphrase
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
  asset: AssetDto
  quantity: string
  valueEur: string | null
  valueUsd: string | null
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
  // nur bei EXCHANGE: maskierter Key (…1234) — niemals Key/Secret selbst
  keyPreview: string | null
  // nur bei WALLET
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
    // Pflicht bei kind=TRANSACTIONS — der Service prüft das kontextabhängig
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
  // erkanntes Export-Format (Spalten dann vollständig vorbelegt)
  preset: 'KRAKEN' | 'BITPANDA' | null
}

export type HistoryRange = '24h' | '7d' | '30d'

export interface PortfolioHistoryPoint {
  t: string // ISO-Zeitstempel
  value: string
}

export interface PortfolioHistoryDto {
  range: HistoryRange
  currency: 'EUR' | 'USD'
  points: PortfolioHistoryPoint[]
  // Anzahl der Assets, die mangels Mapping/Top-N nicht im Verlauf stecken
  excludedAssets: number
}

export interface PortfolioSummaryDto {
  totalEur: string
  totalUsd: string
  pricesFetchedAt: string | null
  byAsset: PortfolioAssetPosition[]
  unmappedAssets: AssetDto[]
}
