import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { fetchCoinSymbol } from '../../coingecko/coingecko.client'
import { refreshPrices } from '../../coingecko/price.service'
import { recordAudit, AuditAction } from './audit.service'

// Admin-only correction path for global asset → CoinGecko mappings. Regular users
// can only map previously unmapped assets (assets.routes); a wrong mapping is
// otherwise permanent. These endpoints let an admin override or clear it.
export const adminAssetsRoutes = Router()

const remapSchema = z.object({ coingeckoId: z.string().trim().min(1).max(120) })

function toDto(asset: { id: string; symbol: string; name: string; coingeckoId: string | null; iconUrl: string | null }) {
  return { id: asset.id, symbol: asset.symbol, name: asset.name, coingeckoId: asset.coingeckoId, iconUrl: asset.iconUrl }
}

// Override (or set) the mapping, even if one already exists.
adminAssetsRoutes.put(
  '/:id/mapping',
  validate(remapSchema),
  asyncHandler(async (req, res) => {
    const assetId = routeParam(req, 'id')
    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) throw AppError.notFound('Asset nicht gefunden')

    const taken = await prisma.asset.findUnique({ where: { coingeckoId: req.body.coingeckoId } })
    if (taken && taken.id !== assetId) {
      throw AppError.conflict('COINGECKO_ID_TAKEN', 'Diese CoinGecko-ID ist bereits einem Asset zugeordnet')
    }

    const coinSymbol = await fetchCoinSymbol(req.body.coingeckoId)
    if (!coinSymbol || coinSymbol !== asset.symbol.toUpperCase()) {
      throw AppError.badRequest(
        'COINGECKO_SYMBOL_MISMATCH',
        'Das gewählte CoinGecko-Coin passt nicht zum Symbol dieses Assets',
      )
    }

    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: { coingeckoId: req.body.coingeckoId },
    })
    await refreshPrices([assetId])
    await recordAudit({
      actor: req.adminUser,
      action: AuditAction.ASSET_MAPPING_UPDATED,
      targetType: 'ASSET',
      targetId: assetId,
    })
    res.json({ asset: toDto(updated) })
  }),
)

// Clear a mapping so it can be re-mapped (e.g. after a bad map).
adminAssetsRoutes.delete(
  '/:id/mapping',
  asyncHandler(async (req, res) => {
    const assetId = routeParam(req, 'id')
    const asset = await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) throw AppError.notFound('Asset nicht gefunden')

    const updated = await prisma.asset.update({ where: { id: assetId }, data: { coingeckoId: null } })
    await recordAudit({
      actor: req.adminUser,
      action: AuditAction.ASSET_MAPPING_CLEARED,
      targetType: 'ASSET',
      targetId: assetId,
    })
    res.json({ asset: toDto(updated) })
  }),
)
