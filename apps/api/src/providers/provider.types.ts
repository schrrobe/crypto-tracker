import type { HoldingAccountType, ProviderId } from '@prisma/client'

// Normalisierte Bilanz eines Providers. `symbol` ist bereits vom Provider-Adapter
// in das übliche Ticker-Symbol übersetzt (z.B. Kraken XXBT → BTC).
export interface RawBalance {
  symbol: string
  // Menge als String — nie float; darf bei MARGIN negativ sein (netAsset < 0)
  amount: string
  // Konto-Typ; fehlt ⇒ SPOT
  accountType?: HoldingAccountType
  // z.B. Solana-Mint-Adresse für exaktes Asset-Mapping
  meta?: Record<string, unknown>
}

// Offene Derivat-Position (Futures/Perpetual). Beträge als String — nie float.
// size in Basis-Asset-Einheiten; uPnL in quoteCurrency.
export interface RawPosition {
  rawSymbol: string
  baseSymbol: string
  side: 'LONG' | 'SHORT'
  size: string
  entryPrice?: string
  markPrice?: string
  leverage?: number
  unrealizedPnl?: string
  quoteCurrency?: string
  liquidationPrice?: string
}

export interface ExchangeCredentials {
  apiKey: string
  // Bitpanda authentifiziert nur über den Key
  apiSecret?: string
  passphrase?: string
}

export interface ExchangeProvider {
  readonly kind: 'exchange'
  readonly id: ProviderId
  // Wird beim Anlegen der Quelle aufgerufen — nutzt ausschließlich Lese-Endpoints
  validateCredentials(creds: ExchangeCredentials): Promise<void>
  // Spot-Bestände (auch für validateCredentials genutzt)
  fetchBalances(creds: ExchangeCredentials): Promise<RawBalance[]>
  // Optional: Multi-Konto-Sync (Spot + Earn/Margin getaggt, Futures-Positionen,
  // Warnungen für übersprungene Subendpoints). Wenn vorhanden, nutzt der Sync
  // diese Methode statt fetchBalances. Spot-only-Börsen implementieren sie nicht.
  fetchAccount?(creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot>
}

export interface ExchangeAccountSnapshot {
  balances: RawBalance[]
  positions?: RawPosition[]
  // z.B. ["EARN nicht freigeschaltet"] → SyncRun bekommt errorCode PARTIAL_SYNC
  warnings?: string[]
}

export interface WalletFetchOptions {
  // Tokens ohne kuratiertes Mapping (z.B. unbekannte Solana-Mints) mitliefern?
  // Default false — Spam-/Dust-Filter
  includeUnknownTokens?: boolean
}

// On-Chain-Staking-Reward, vom Sync als STAKING_REWARD-Transaktion persistiert.
// externalRef macht den Import idempotent (unique, z.B. sol-reward:<account>:<epoch>).
export interface RawStakingReward {
  symbol: string
  amount: string
  timestamp: Date
  externalRef: string
}

export interface WalletProvider {
  readonly kind: 'wallet'
  readonly id: ProviderId
  validateAddress(address: string): boolean
  fetchBalances(address: string, options?: WalletFetchOptions): Promise<RawBalance[]>
  // Optional: Staking-Rewards seit lastExternalRef (null = Erst-Import, begrenztes Fenster)
  fetchStakingRewards?(
    address: string,
    sinceHint: { lastExternalRef: string | null },
  ): Promise<RawStakingReward[]>
}

export type Provider = ExchangeProvider | WalletProvider

// Typisierte Provider-Fehler → landen als errorCode im SyncRun
export class ProviderError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_API_KEY'
      | 'INVALID_ADDRESS'
      | 'RATE_LIMITED'
      | 'PROVIDER_ERROR'
      // Key ist gültig, aber ein Konto-Typ-Subendpoint (Earn/Margin/Futures) ist
      // nicht freigeschaltet — darf den Gesamt-Sync nicht abbrechen
      | 'ENDPOINT_FORBIDDEN',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
