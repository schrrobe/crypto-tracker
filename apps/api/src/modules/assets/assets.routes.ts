import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { routeParam } from '../../lib/params'
import { prisma } from '../../lib/prisma'
import { searchCoins } from '../../coingecko/coingecko.client'
import { refreshPrices } from '../../coingecko/price.service'

export const assetsRoutes = Router()
assetsRoutes.use(requireAuth)

// Local asset search; CoinGecko search + manual mapping arrive with milestone 8
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

// CoinGecko search for the manual price mapping of unmapped assets
assetsRoutes.get(
  '/coingecko-search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (!q) {
      res.json({ coins: [] })
      return
    }
    res.json({ coins: await searchCoins(q) })
  }),
)

const mappingSchema = z.object({ coingeckoId: z.string().trim().min(1).max(120) })

// Mapping takes effect globally (assets are shared across users) — therefore only
// allowed for previously unmapped assets; existing mappings remain untouchable.
assetsRoutes.post(
  '/:id/mapping',
  validate(mappingSchema),
  asyncHandler(async (req, res) => {
    const assetId = routeParam(req, 'id')
    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) throw AppError.notFound('Asset nicht gefunden')
    if (asset.coingeckoId) {
      throw AppError.conflict('ASSET_ALREADY_MAPPED', 'Dieses Asset hat bereits ein Preis-Mapping')
    }
    const taken = await prisma.asset.findUnique({ where: { coingeckoId: req.body.coingeckoId } })
    if (taken) {
      throw AppError.conflict('COINGECKO_ID_TAKEN', 'Diese CoinGecko-ID ist bereits einem Asset zugeordnet')
    }

    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: { coingeckoId: req.body.coingeckoId },
    })
    await refreshPrices([assetId])
    res.json({
      asset: {
        id: updated.id,
        symbol: updated.symbol,
        name: updated.name,
        coingeckoId: updated.coingeckoId,
        iconUrl: updated.iconUrl,
      },
    })
  }),
)
