// Market overview (Top 100): display-only data — numbers are fine here,
// nothing flows into the money pipeline (no Decimal needed)
export interface MarketCoinDto {
  id: string
  symbol: string
  name: string
  iconUrl: string | null
  price: number
  marketCap: number
  rank: number
  change24hPct: number | null
}

export interface MarketDto {
  coins: MarketCoinDto[]
  fetchedAt: string
}
