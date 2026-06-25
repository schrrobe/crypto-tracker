import type { HoldingAccountType, ProviderId } from '@prisma/client'

// Normalized balance from a provider. `symbol` has already been translated by the
// provider adapter into the usual ticker symbol (e.g. Kraken XXBT → BTC).
export interface RawBalance {
  symbol: string
  // Amount as a string — never float; may be negative for MARGIN (netAsset < 0)
  amount: string
  // Account type; absent ⇒ SPOT
  accountType?: HoldingAccountType
  // e.g. Solana mint address for exact asset mapping
  meta?: Record<string, unknown>
}

// Open derivative position (Futures/Perpetual). Amounts as strings — never float.
// size in base-asset units; uPnL in quoteCurrency.
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
  // Bitpanda authenticates via the key only
  apiSecret?: string
  passphrase?: string
}

export interface ExchangeProvider {
  readonly kind: 'exchange'
  readonly id: ProviderId
  // Called when the source is created — uses read-only endpoints exclusively
  validateCredentials(creds: ExchangeCredentials): Promise<void>
  // Spot balances (also used by validateCredentials)
  fetchBalances(creds: ExchangeCredentials): Promise<RawBalance[]>
  // Optional: multi-account sync (Spot + Earn/Margin tagged, Futures positions,
  // warnings for skipped sub-endpoints). If present, the sync uses this method
  // instead of fetchBalances. Spot-only exchanges do not implement it.
  fetchAccount?(creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot>
}

export interface ExchangeAccountSnapshot {
  balances: RawBalance[]
  positions?: RawPosition[]
  // e.g. ["EARN not enabled"] → SyncRun gets errorCode PARTIAL_SYNC
  warnings?: string[]
}

export interface WalletFetchOptions {
  // Also return tokens without a curated mapping (e.g. unknown Solana mints)?
  // Default false — spam/dust filter
  includeUnknownTokens?: boolean
}

// On-chain staking reward, persisted by the sync as a STAKING_REWARD transaction.
// externalRef makes the import idempotent (unique, e.g. sol-reward:<account>:<epoch>).
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
  // Optional: staking rewards since lastExternalRef (null = first import, limited window)
  fetchStakingRewards?(
    address: string,
    sinceHint: { lastExternalRef: string | null },
  ): Promise<RawStakingReward[]>
}

export type Provider = ExchangeProvider | WalletProvider

// Typed provider errors → land as errorCode in the SyncRun
export class ProviderError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_API_KEY'
      | 'INVALID_ADDRESS'
      | 'RATE_LIMITED'
      | 'PROVIDER_ERROR'
      // Key is valid, but an account-type sub-endpoint (Earn/Margin/Futures) is
      // not enabled — must not abort the overall sync
      | 'ENDPOINT_FORBIDDEN',
    message: string,
    // HTTP status of the underlying response when the error came from a transport
    // failure (vs. a JSON-RPC application error, which has none). Callers use it to
    // tell retryable statuses (429/5xx) apart from terminal ones (4xx).
    public readonly status?: number,
    // Rewards collected before a staking-reward import stopped early (transient RPC
    // failure / missing block time). The sync persists these, then flags the run
    // PARTIAL_SYNC — distinguishing a truncated import from a clean, complete one.
    public readonly partialRewards?: RawStakingReward[],
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
