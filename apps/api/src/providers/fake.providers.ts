import type { ProviderId } from '@prisma/client'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
  type WalletProvider,
} from './provider.types'

// Deterministische Provider für E2E-Tests und lokale Entwicklung (FAKE_PROVIDERS=true).
// Steuerbar über den API-Key bzw. die Adresse:
//   apiKey "INVALID..."  → validateCredentials schlägt fehl
//   apiKey "SYNCFAIL..." → validateCredentials ok, fetchBalances wirft (Fehlerpfad im SyncRun)

const FAKE_EXCHANGE_BALANCES: RawBalance[] = [
  { symbol: 'BTC', amount: '0.1' },
  { symbol: 'ETH', amount: '2' },
]

const FAKE_WALLET_BALANCES: Record<string, RawBalance[]> = {
  BITCOIN: [{ symbol: 'BTC', amount: '0.05' }],
  SOLANA: [{ symbol: 'SOL', amount: '12' }],
  ETHEREUM: [
    { symbol: 'ETH', amount: '1.5' },
    { symbol: 'STETH', amount: '3' },
  ],
  POLYGON: [{ symbol: 'POL', amount: '100' }],
  ARBITRUM: [{ symbol: 'ETH', amount: '0.4' }],
  BASE: [{ symbol: 'ETH', amount: '0.3' }],
  BSC: [{ symbol: 'BNB', amount: '2' }],
  LITECOIN: [{ symbol: 'LTC', amount: '5' }],
  DOGECOIN: [{ symbol: 'DOGE', amount: '1000' }],
  CARDANO: [{ symbol: 'ADA', amount: '500' }],
  XRP: [{ symbol: 'XRP', amount: '200' }],
  TRON: [{ symbol: 'TRX', amount: '300' }],
  COSMOS: [{ symbol: 'ATOM', amount: '25' }],
}

// Deterministische Rewards für Integrationstests: feste externalRefs →
// wiederholter Sync darf keine Duplikate erzeugen (skipDuplicates-Pfad)
const FAKE_STAKING_REWARDS: Record<string, Array<{ symbol: string; amount: string; iso: string; ref: string }>> = {
  SOLANA: [
    { symbol: 'SOL', amount: '0.05', iso: '2024-03-01T00:00:00.000Z', ref: 'fake-sol-reward:1' },
    { symbol: 'SOL', amount: '0.07', iso: '2024-03-03T00:00:00.000Z', ref: 'fake-sol-reward:2' },
  ],
  ETHEREUM: [{ symbol: 'ETH', amount: '0.01', iso: '2024-04-01T00:00:00.000Z', ref: 'fake-eth-wd:1' }],
}

export function fakeExchangeProvider(id: ProviderId): ExchangeProvider {
  return {
    kind: 'exchange',
    id,
    async validateCredentials(creds: ExchangeCredentials) {
      if (creds.apiKey.startsWith('INVALID')) {
        throw new ProviderError('INVALID_API_KEY', 'API-Key wurde vom Anbieter abgelehnt')
      }
    },
    async fetchBalances(creds: ExchangeCredentials) {
      if (creds.apiKey.startsWith('SYNCFAIL')) {
        throw new ProviderError('PROVIDER_ERROR', 'Anbieter nicht erreichbar (simuliert)')
      }
      return FAKE_EXCHANGE_BALANCES
    },
  }
}

export function fakeWalletProvider(id: ProviderId): WalletProvider {
  return {
    kind: 'wallet',
    id,
    validateAddress(address: string) {
      return address.length >= 10 && !address.startsWith('INVALID')
    },
    async fetchBalances() {
      return FAKE_WALLET_BALANCES[id] ?? []
    },
    async fetchStakingRewards(address: string) {
      // Adresse in die Ref aufnehmen — externalRef ist global unique (beim echten
      // Provider übernimmt das der Stake-Account-Pubkey bzw. der Withdrawal-Index)
      return (FAKE_STAKING_REWARDS[id] ?? []).map((r) => ({
        symbol: r.symbol,
        amount: r.amount,
        timestamp: new Date(r.iso),
        externalRef: `${r.ref}:${address}`,
      }))
    },
  }
}
