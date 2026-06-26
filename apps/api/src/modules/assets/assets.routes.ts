import { Prisma } from '@prisma/client'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { routeParam } from '../../lib/params'
import { prisma } from '../../lib/prisma'
import { searchCoins, fetchCoinSymbol } from '../../coingecko/coingecko.client'
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

// Mapping is a global write (assets are shared) — rate-limit so one account can't
// sweep many assets. Generous in local/test so the suite isn't throttled.
const mappingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.APP_ENV === 'local' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Zu viele Mapping-Versuche, bitte später erneut' } },
})

// Mapping takes effect globally (assets are shared across users) — therefore only
// allowed for previously unmapped assets; existing mappings remain untouchable.
// The chosen CoinGecko coin's symbol must match the asset symbol (validated
// server-side) so a user cannot mis-map a shared asset to an unrelated coin.
assetsRoutes.post(
  '/:id/mapping',
  mappingLimiter,
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

    // Verify the chosen coin actually is this asset: its CoinGecko symbol must
    // match. Prevents poisoning a globally shared asset with an unrelated coin id.
    const coinSymbol = await fetchCoinSymbol(req.body.coingeckoId)
    if (!coinSymbol || coinSymbol !== asset.symbol.toUpperCase()) {
      throw AppError.badRequest(
        'COINGECKO_SYMBOL_MISMATCH',
        'Das gewählte CoinGecko-Coin passt nicht zum Symbol dieses Assets',
      )
    }

    let updated
    try {
      updated = await prisma.asset.update({
        where: { id: assetId },
        data: { coingeckoId: req.body.coingeckoId },
      })
    } catch (e) {
      // Concurrent mapping to the same CoinGecko-ID: the check-then-update above
      // is not atomic, so the unique constraint may still fire — surface it as a
      // clean conflict instead of a 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppError.conflict('COINGECKO_ID_TAKEN', 'Diese CoinGecko-ID ist bereits einem Asset zugeordnet')
      }
      throw e
    }
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
