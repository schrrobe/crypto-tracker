import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { fetchCoinSymbol } from '../../coingecko/coingecko.client'
import { refreshPrices } from '../../coingecko/price.service'
import { recordAudit, AuditAction, type AuditActor } from './audit.service'

type AssetRow = { id: string; symbol: string; name: string; coingeckoId: string | null; iconUrl: string | null }

// Override (or set) a global asset → CoinGecko mapping. Validates that the target
// coin's symbol matches the asset, writes the mapping + audit atomically, then
// refreshes prices for the newly-mapped asset.
export async function remapAsset(assetId: string, coingeckoId: string, actor: AuditActor): Promise<AssetRow> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } })
  if (!asset) throw AppError.notFound('Asset nicht gefunden')

  const taken = await prisma.asset.findUnique({ where: { coingeckoId } })
  if (taken && taken.id !== assetId) {
    throw AppError.conflict('COINGECKO_ID_TAKEN', 'Diese CoinGecko-ID ist bereits einem Asset zugeordnet')
  }

  const coinSymbol = await fetchCoinSymbol(coingeckoId)
  if (!coinSymbol || coinSymbol !== asset.symbol.toUpperCase()) {
    throw AppError.badRequest(
      'COINGECKO_SYMBOL_MISMATCH',
      'Das gewählte CoinGecko-Coin passt nicht zum Symbol dieses Assets',
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.asset.update({ where: { id: assetId }, data: { coingeckoId } })
    await recordAudit({
      actor,
      action: AuditAction.ASSET_MAPPING_UPDATED,
      targetType: 'ASSET',
      targetId: assetId,
    }, tx)
    return row
  })
  await refreshPrices([assetId])
  return updated
}

// Clear a mapping so the asset can be re-mapped (e.g. after a bad map).
export async function clearAssetMapping(assetId: string, actor: AuditActor): Promise<AssetRow> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } })
  if (!asset) throw AppError.notFound('Asset nicht gefunden')

  return prisma.$transaction(async (tx) => {
    const row = await tx.asset.update({ where: { id: assetId }, data: { coingeckoId: null } })
    await recordAudit({
      actor,
      action: AuditAction.ASSET_MAPPING_CLEARED,
      targetType: 'ASSET',
      targetId: assetId,
    }, tx)
    return row
  })
}
