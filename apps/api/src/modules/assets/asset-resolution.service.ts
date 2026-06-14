import type { Asset } from '@prisma/client'
import { prisma } from '../../lib/prisma'

// Symbol → asset. On ticker collisions the mapped asset wins (coingeckoId set);
// unknown symbols create an unmapped asset (no price, the UI shows a hint).
export async function resolveAssetsBySymbol(symbols: string[]): Promise<Map<string, Asset>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))]
  const existing = await prisma.asset.findMany({ where: { symbol: { in: unique } } })

  const result = new Map<string, Asset>()
  for (const symbol of unique) {
    const candidates = existing.filter((a) => a.symbol === symbol)
    const chosen = candidates.find((a) => a.coingeckoId !== null) ?? candidates[0]
    if (chosen) {
      result.set(symbol, chosen)
    } else {
      const created = await prisma.asset.create({
        data: { symbol, name: symbol, coingeckoId: null },
      })
      result.set(symbol, created)
    }
  }
  return result
}
