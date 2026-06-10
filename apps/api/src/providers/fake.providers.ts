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
  }
}
