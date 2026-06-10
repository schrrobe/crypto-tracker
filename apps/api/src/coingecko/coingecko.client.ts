import { env } from '../config/env'
import { AppError } from '../lib/errors'

const BASE = 'https://api.coingecko.com/api/v3'

export type SimplePrices = Record<string, { eur?: number; usd?: number }>

// Deterministische Preise für Tests/lokale Entwicklung ohne echte API
const FAKE_PRICES: Record<string, { eur: number; usd: number }> = {
  bitcoin: { eur: 50_000, usd: 55_000 },
  ethereum: { eur: 2_000, usd: 2_200 },
  solana: { eur: 100, usd: 110 },
  tether: { eur: 0.9, usd: 1 },
  'usd-coin': { eur: 0.9, usd: 1 },
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function fetchSimplePrices(coingeckoIds: string[]): Promise<SimplePrices> {
  if (coingeckoIds.length === 0) return {}

  if (env.FAKE_PRICES) {
    return Object.fromEntries(
      coingeckoIds.map((id) => [id, FAKE_PRICES[id] ?? { eur: 1, usd: 1.1 }]),
    )
  }

  const result: SimplePrices = {}
  for (const batch of chunk(coingeckoIds, 250)) {
    const url = `${BASE}/simple/price?ids=${batch.join(',')}&vs_currencies=eur,usd`
    const res = await fetch(url, {
      headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
    })
    if (!res.ok) {
      throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
    }
    Object.assign(result, (await res.json()) as SimplePrices)
  }
  return result
}
