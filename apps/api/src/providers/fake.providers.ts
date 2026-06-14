import type { ProviderId } from '@prisma/client'
import {
  ProviderError,
  type ExchangeAccountSnapshot,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
  type RawPosition,
  type WalletProvider,
} from './provider.types'

// Deterministische Provider für E2E-Tests und lokale Entwicklung (FAKE_PROVIDERS=true).
// Steuerbar über den API-Key bzw. die Adresse:
//   apiKey "INVALID..."      → validateCredentials schlägt fehl
//   apiKey "SYNCFAIL..."     → validateCredentials ok, fetchBalances wirft (Fehlerpfad im SyncRun)
//   apiKey "FORBIDDEN-EARN…" → Spot synct, der EARN-Subendpoint wirft ENDPOINT_FORBIDDEN
//                              (Teil-Erfolg → SyncRun-errorCode PARTIAL_SYNC)

const FAKE_EXCHANGE_BALANCES: RawBalance[] = [
  { symbol: 'BTC', amount: '0.1', accountType: 'SPOT' },
  { symbol: 'ETH', amount: '2', accountType: 'SPOT' },
]

// Earn/Margin getrennt — gleiches Asset (BTC) unter mehreren Kontotypen, plus
// eine negative Margin-Verbindlichkeit (USDT) für den Netto-Bewertungstest
const FAKE_EARN_BALANCES: RawBalance[] = [{ symbol: 'BTC', amount: '0.05', accountType: 'EARN' }]
const FAKE_MARGIN_BALANCES: RawBalance[] = [{ symbol: 'USDT', amount: '-300', accountType: 'MARGIN' }]

const FAKE_FUTURES_POSITIONS: RawPosition[] = [
  {
    rawSymbol: 'BTCUSDT',
    baseSymbol: 'BTC',
    side: 'LONG',
    size: '0.02',
    entryPrice: '48000',
    markPrice: '50000',
    leverage: 5,
    unrealizedPnl: '40',
    quoteCurrency: 'USDT',
    liquidationPrice: '40000',
  },
  {
    rawSymbol: 'ETHUSDT',
    baseSymbol: 'ETH',
    side: 'SHORT',
    size: '1',
    entryPrice: '3100',
    markPrice: '3000',
    leverage: 3,
    unrealizedPnl: '100',
    quoteCurrency: 'USDT',
    liquidationPrice: '3500',
  },
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

// Nur diese Fake-Provider liefern Multi-Konto-Daten (Earn/Margin/Futures) —
// Spot-only-Börsen (Kraken, Coinbase, …) bleiben beim einfachen Bestand, damit
// bestehende Tests/Fixtures unverändert gelten.
const MULTI_ACCOUNT_FAKES = new Set<ProviderId>(['BINANCE', 'OKX', 'BYBIT', 'KUCOIN'])

export function fakeExchangeProvider(id: ProviderId): ExchangeProvider {
  const provider: ExchangeProvider = {
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
  if (MULTI_ACCOUNT_FAKES.has(id)) {
    provider.fetchAccount = async (creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot> => {
      if (creds.apiKey.startsWith('SYNCFAIL')) {
        throw new ProviderError('PROVIDER_ERROR', 'Anbieter nicht erreichbar (simuliert)')
      }
      const balances = [...FAKE_EXCHANGE_BALANCES, ...FAKE_MARGIN_BALANCES]
      const warnings: string[] = []
      // EARN nur, wenn der Key den Subendpoint nicht sperrt
      if (creds.apiKey.startsWith('FORBIDDEN-EARN')) {
        warnings.push('Earn: nicht freigeschaltet (simuliert)')
      } else {
        balances.push(...FAKE_EARN_BALANCES)
      }
      return { balances, positions: FAKE_FUTURES_POSITIONS, warnings }
    }
  }
  return provider
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
