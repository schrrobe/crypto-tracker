import type { ProviderId } from '@prisma/client'

// Normalisierte Bilanz eines Providers. `symbol` ist bereits vom Provider-Adapter
// in das übliche Ticker-Symbol übersetzt (z.B. Kraken XXBT → BTC).
export interface RawBalance {
  symbol: string
  // Menge als String — nie float
  amount: string
  // z.B. Solana-Mint-Adresse für exaktes Asset-Mapping
  meta?: Record<string, unknown>
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
  fetchBalances(creds: ExchangeCredentials): Promise<RawBalance[]>
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
    public readonly code: 'INVALID_API_KEY' | 'INVALID_ADDRESS' | 'RATE_LIMITED' | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
