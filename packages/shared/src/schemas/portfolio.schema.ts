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

export interface SourceDto {
  id: string
  type: SourceType
  provider: ProviderId
  label: string
  lastSyncAt: string | null
  createdAt: string
}

export interface PortfolioAssetPosition {
  asset: AssetDto
  quantity: string
  valueEur: string | null
  valueUsd: string | null
}

export interface PortfolioSummaryDto {
  totalEur: string
  totalUsd: string
  pricesFetchedAt: string | null
  byAsset: PortfolioAssetPosition[]
  unmappedAssets: AssetDto[]
}
