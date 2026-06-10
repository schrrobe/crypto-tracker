import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../lib/prisma'

export const assetsRoutes = Router()
assetsRoutes.use(requireAuth)

// Lokale Asset-Suche; CoinGecko-Suche + manuelles Mapping kommen mit Meilenstein 8
assetsRoutes.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const assets = await prisma.asset.findMany({
      where: q
        ? {
            OR: [
              { symbol: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { symbol: 'asc' },
      take: 50,
    })
    res.json({
      assets: assets.map((a) => ({
        id: a.id,
        symbol: a.symbol,
        name: a.name,
        coingeckoId: a.coingeckoId,
        iconUrl: a.iconUrl,
      })),
    })
  }),
)
