import { Prisma } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { fetchHistoricalPrice } from '../../coingecko/coingecko.client'

// Pro Report-Lauf hart begrenzen; nicht aufgelöste Daten kommen beim nächsten
// Lauf aus dem Cache nach. Mit Demo-Key (~30 Calls/min, 10k/Monat) deutlich
// großzügiger als ohne Key (öffentliches Limit ist erheblich schärfer).
const LOOKUP_CAP_PER_RUN = env.COINGECKO_API_KEY ? 150 : 40

export interface HistoricalPriceRequest {
  assetId: string
  coingeckoId: string | null
  // wird auf 00:00 UTC normalisiert
  date: Date
}

export interface HistoricalPriceResult {
  // Key: priceKey(assetId, date). Wert null = kein Preis ermittelbar (Negativ-Cache).
  // Fehlender Key = Lookup-Cap erreicht, beim nächsten Lauf erneut versuchen.
  prices: Map<string, Prisma.Decimal | null>
  limitReached: boolean
}

export function toUtcDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function priceKey(assetId: string, date: Date): string {
  return `${assetId}|${toUtcDate(date).toISOString().slice(0, 10)}`
}

export async function resolveHistoricalPrices(
  requests: HistoricalPriceRequest[],
): Promise<HistoricalPriceResult> {
  const prices = new Map<string, Prisma.Decimal | null>()

  // Dedupe auf (Asset, Tag); unmapped Assets haben nie einen Preis
  const unique = new Map<string, HistoricalPriceRequest>()
  for (const req of requests) {
    const key = priceKey(req.assetId, req.date)
    if (req.coingeckoId === null) {
      prices.set(key, null)
      continue
    }
    if (!unique.has(key)) unique.set(key, { ...req, date: toUtcDate(req.date) })
  }
  if (unique.size === 0) return { prices, limitReached: false }

  const cached = await prisma.historicalAssetPrice.findMany({
    where: {
      assetId: { in: [...new Set([...unique.values()].map((r) => r.assetId))] },
      date: { in: [...new Set([...unique.values()].map((r) => r.date.getTime()))].map((t) => new Date(t)) },
    },
  })
  for (const row of cached) {
    const key = priceKey(row.assetId, row.date)
    if (unique.has(key)) {
      prices.set(key, row.priceEur)
      unique.delete(key)
    }
  }

  let lookups = 0
  let limitReached = false
  // CoinGecko-Calls bleiben seriell (Rate-Limit); die DB-Schreibvorgänge sammeln
  // wir und schreiben sie am Ende in EINEM createMany statt N Einzel-Upserts.
  const fetched: { assetId: string; date: Date; priceEur: Prisma.Decimal | null }[] = []
  for (const [key, req] of unique) {
    if (lookups >= LOOKUP_CAP_PER_RUN) {
      limitReached = true
      break
    }
    lookups += 1
    const price = await fetchHistoricalPrice(req.coingeckoId as string, req.date)
    const priceEur = price === null ? null : new Prisma.Decimal(price.toString())
    fetched.push({ assetId: req.assetId, date: req.date, priceEur })
    prices.set(key, priceEur)
  }

  // skipDuplicates fängt den Fall ab, dass ein paralleler Lauf denselben
  // (Asset, Tag) bereits geschrieben hat (zuvor: upsert mit leerem update).
  if (fetched.length > 0) {
    await prisma.historicalAssetPrice.createMany({ data: fetched, skipDuplicates: true })
  }

  return { prices, limitReached }
}
