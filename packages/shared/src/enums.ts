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
  BINANCE: 'BINANCE',
  OKX: 'OKX',
  BYBIT: 'BYBIT',
  KUCOIN: 'KUCOIN',
  BITSTAMP: 'BITSTAMP',
  GATEIO: 'GATEIO',
  CRYPTOCOM: 'CRYPTOCOM',
  BITCOIN: 'BITCOIN',
  SOLANA: 'SOLANA',
  ETHEREUM: 'ETHEREUM',
  POLYGON: 'POLYGON',
  ARBITRUM: 'ARBITRUM',
  BASE: 'BASE',
  BSC: 'BSC',
  LITECOIN: 'LITECOIN',
  DOGECOIN: 'DOGECOIN',
  CARDANO: 'CARDANO',
  XRP: 'XRP',
  TRON: 'TRON',
  COSMOS: 'COSMOS',
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

export const HoldingAccountType = {
  SPOT: 'SPOT',
  EARN: 'EARN',
  MARGIN: 'MARGIN',
  FUTURES: 'FUTURES',
} as const
export type HoldingAccountType = (typeof HoldingAccountType)[keyof typeof HoldingAccountType]

export const PositionSide = {
  LONG: 'LONG',
  SHORT: 'SHORT',
} as const
export type PositionSide = (typeof PositionSide)[keyof typeof PositionSide]

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
