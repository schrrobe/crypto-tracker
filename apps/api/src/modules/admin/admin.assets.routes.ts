import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as assets from './admin.assets.service'

// Admin-only correction path for global asset → CoinGecko mappings. These
// endpoints let an admin override or clear an existing mapping.
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
    const asset = await assets.remapAsset(routeParam(req, 'id'), req.body.coingeckoId, req.adminUser)
    res.json({ asset: toDto(asset) })
  }),
)

// Clear a mapping so it can be re-mapped (e.g. after a bad map).
adminAssetsRoutes.delete(
  '/:id/mapping',
  asyncHandler(async (req, res) => {
    const asset = await assets.clearAssetMapping(routeParam(req, 'id'), req.adminUser)
    res.json({ asset: toDto(asset) })
  }),
)
