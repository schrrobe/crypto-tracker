import { z } from 'zod'
import { TxType } from '../enums'
import type { AssetDto } from './portfolio.schema'
import { quantityString } from './portfolio.schema'

// Wie quantityString, aber 0 erlaubt — für Kurs und Gebühr (z.B. gebührenfreier Kauf)
export const amountString = z
  .string()
  .regex(/^\d{1,20}([.,]\d{1,18})?$/, 'Ungültiger Betrag')
  .transform((v) => v.replace(',', '.'))

const TX_TYPES = Object.values(TxType) as [TxType, ...TxType[]]

export const createTransactionSchema = z.object({
  assetId: z.string().uuid(),
  type: z.enum(TX_TYPES),
  quantity: quantityString,
  // Kurs in Fiat pro Einheit zum Transaktionszeitpunkt — optional, aber ohne Kurs
  // kann der Steuerreport die Position nur per Preis-Backfill bewerten
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
})
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>

export const updateTransactionSchema = createTransactionSchema.partial()
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>

export const listTransactionsQuerySchema = z.object({
  year: z.coerce.number().int().min(2009).max(2100).optional(),
  assetId: z.string().uuid().optional(),
})

export interface TransactionDto {
  id: string
  sourceId: string
  sourceLabel: string
  // nur manuelle Transaktionen sind über die API änderbar; importierte gehören dem CSV-Import
  editable: boolean
  asset: AssetDto
  type: TxType
  quantity: string
  pricePerUnit: string | null
  feeAmount: string | null
  currency: string | null
  timestamp: string
}
