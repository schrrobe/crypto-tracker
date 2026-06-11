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
})

export const EXCHANGE_PROVIDERS = ['COINBASE', 'KRAKEN', 'BITVAVO', 'BITPANDA'] as const
export const WALLET_PROVIDERS = ['BITCOIN', 'SOLANA'] as const

export const createExchangeSourceSchema = z.object({
  type: z.literal('EXCHANGE'),
  provider: z.enum(EXCHANGE_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  apiKey: z.string().trim().min(4).max(500),
  apiSecret: z.string().trim().min(4).max(500),
  passphrase: z.string().trim().max(200).optional(),
})

export const createWalletSourceSchema = z.object({
  type: z.literal('WALLET'),
  provider: z.enum(WALLET_PROVIDERS),
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(10).max(120),
})

export const createSourceSchema = z.discriminatedUnion('type', [
  createManualSourceSchema,
  createExchangeSourceSchema,
  createWalletSourceSchema,
])
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
  }),
})
export type ConfirmMappingInput = z.infer<typeof confirmMappingSchema>

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
  suggestedMapping: { symbol: string | null; quantity: string | null }
}

export interface PortfolioSummaryDto {
  totalEur: string
  totalUsd: string
  pricesFetchedAt: string | null
  byAsset: PortfolioAssetPosition[]
  unmappedAssets: AssetDto[]
}
