// Muss mit den Prisma-Enums in apps/api/prisma/schema.prisma übereinstimmen.
// Hier als const-Objekte, damit das Frontend keine Prisma-Abhängigkeit braucht.

export const SourceType = {
  EXCHANGE: 'EXCHANGE',
  WALLET: 'WALLET',
  CSV_IMPORT: 'CSV_IMPORT',
  MANUAL: 'MANUAL',
} as const
export type SourceType = (typeof SourceType)[keyof typeof SourceType]

export const ProviderId = {
  COINBASE: 'COINBASE',
  KRAKEN: 'KRAKEN',
  BITVAVO: 'BITVAVO',
  BITPANDA: 'BITPANDA',
  BITCOIN: 'BITCOIN',
  SOLANA: 'SOLANA',
  ETHEREUM: 'ETHEREUM',
  GENERIC_CSV: 'GENERIC_CSV',
  MANUAL: 'MANUAL',
} as const
export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId]

export const SyncStatus = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
} as const
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus]

export const ImportStatus = {
  PENDING_MAPPING: 'PENDING_MAPPING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus]

export const ImportKind = {
  BALANCES: 'BALANCES',
  TRANSACTIONS: 'TRANSACTIONS',
} as const
export type ImportKind = (typeof ImportKind)[keyof typeof ImportKind]

export const TxType = {
  BUY: 'BUY',
  SELL: 'SELL',
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  TRANSFER: 'TRANSFER',
  STAKING_REWARD: 'STAKING_REWARD',
  OTHER: 'OTHER',
} as const
export type TxType = (typeof TxType)[keyof typeof TxType]
