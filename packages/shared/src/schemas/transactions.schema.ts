import { z } from 'zod'
import { TxType } from '../enums'
import type { AssetDto } from './portfolio.schema'
import { quantityString } from './portfolio.schema'

// Like quantityString, but 0 is allowed — for price and fee (e.g. fee-free purchase)
export const amountString = z
  .string()
  .regex(/^\d{1,20}([.,]\d{1,18})?$/, 'Ungültiger Betrag')
  .transform((v) => v.replace(',', '.'))

const TX_TYPES = Object.values(TxType) as [TxType, ...TxType[]]

export const createTransactionSchema = z.object({
  assetId: z.string().uuid(),
  type: z.enum(TX_TYPES),
  quantity: quantityString,
  // price in fiat per unit at the transaction time — optional, but without a price
  // the tax report can only value the position via price backfill
  pricePerUnit: amountString.optional(),
  feeAmount: amountString.optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'Währung muss ein 3-Buchstaben-Code sein')
    .transform((v) => v.toUpperCase())
    .optional(),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .refine((v) => new Date(v).getTime() <= Date.now(), 'Zeitpunkt liegt in der Zukunft'),
  portfolioId: z.string().uuid().optional(),
})
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>

export const updateTransactionSchema = createTransactionSchema.partial()
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>

export const listTransactionsQuerySchema = z.object({
  year: z.coerce.number().int().min(2009).max(2100).optional(),
  assetId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  portfolioId: z.string().uuid().optional(),
})

export const transferLinkSchema = z.object({
  counterpartId: z.string().uuid(),
})
export type TransferLinkInput = z.infer<typeof transferLinkSchema>
// Swap uses the same input shape (counterpart transaction)
export const swapLinkSchema = transferLinkSchema
export type SwapLinkInput = TransferLinkInput

export interface TransactionTransferLinkDto {
  id: string
  counterpartTxId: string
  counterpartSourceLabel: string
  // OUT = this tx is the withdrawal, IN = the deposit
  direction: 'OUT' | 'IN'
}

export interface TransactionSwapLinkDto {
  id: string
  counterpartTxId: string
  counterpartSourceLabel: string
  counterpartAssetSymbol: string
  // OUT = this tx is the SELL side (asset A), IN = the BUY side (asset B)
  direction: 'OUT' | 'IN'
}

export interface TransactionDto {
  id: string
  sourceId: string
  sourceLabel: string
  // only manual transactions are editable via the API; imported ones belong to the CSV import
  editable: boolean
  asset: AssetDto
  type: TxType
  quantity: string
  pricePerUnit: string | null
  feeAmount: string | null
  currency: string | null
  timestamp: string
  // set when this WITHDRAWAL/DEPOSIT tx is linked as a transfer pair
  transferLink: TransactionTransferLinkDto | null
  // set when this SELL/BUY tx is linked as a crypto-to-crypto swap
  swapLink: TransactionSwapLinkDto | null
}
