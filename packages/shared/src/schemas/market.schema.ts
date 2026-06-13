// Marktüberblick (Top 100): reine Anzeige-Daten — numbers sind hier ok,
// es fließt nichts in die Geld-Pipeline (kein Decimal nötig)
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
