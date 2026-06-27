import { Prisma, type PortfolioSource } from '@prisma/client'
import { FREE_LIMITS, type CreateSourceInput, type SourceDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { encryptSecret, keyPreview } from '../../lib/crypto'
import { getPlan } from '../../middleware/plan.middleware'
import { getExchangeProvider, getWalletProvider } from '../../providers/provider.registry'
import { ProviderError } from '../../providers/provider.types'
import { toSyncRunDto } from '../sync/syncRun.mapper'
import { resolvePortfolioId } from '../portfolios/portfolios.service'

type SourceWithRelations = Prisma.PortfolioSourceGetPayload<{
  include: { credential: { select: { keyPreview: true } }; wallet: true; syncRuns: true }
}>

const SOURCE_INCLUDE = {
  // Deliberately only keyPreview — encrypted secrets never leave the service
  credential: { select: { keyPreview: true } },
  wallet: true,
  syncRuns: { orderBy: { startedAt: 'desc' as const }, take: 1 },
}

export function toSourceDto(source: SourceWithRelations): SourceDto {
  return {
    id: source.id,
    type: source.type,
    provider: source.provider,
    label: source.label,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    keyPreview: source.credential?.keyPreview ?? null,
    address: source.wallet?.address ?? null,
    chain: source.wallet?.chain ?? null,
    includeUnknownTokens: source.wallet?.includeUnknownTokens ?? null,
    lastSyncRun: source.syncRuns[0] ? toSyncRunDto(source.syncRuns[0]) : null,
  }
}

export async function listSources(userId: string, portfolioId?: string): Promise<SourceDto[]> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const sources = await prisma.portfolioSource.findMany({
    where: { userId, portfolioId: pid },
    include: SOURCE_INCLUDE,
    orderBy: { createdAt: 'asc' },
  })
  return sources.map(toSourceDto)
}

// Throws 404 instead of 403 for foreign sources — does not reveal that the ID exists
export async function getOwnedSource(userId: string, sourceId: string): Promise<PortfolioSource> {
  const source = await prisma.portfolioSource.findFirst({ where: { id: sourceId, userId } })
  if (!source) throw AppError.notFound('Quelle nicht gefunden')
  return source
}

async function reloadDto(sourceId: string): Promise<SourceDto> {
  const source = await prisma.portfolioSource.findUniqueOrThrow({
    where: { id: sourceId },
    include: SOURCE_INCLUDE,
  })
  return toSourceDto(source)
}

export async function createSource(userId: string, input: CreateSourceInput): Promise<SourceDto> {
  // Free limit: max. FREE_LIMITS.sources sources in total
  if ((await getPlan(userId)) !== 'PRO') {
    const count = await prisma.portfolioSource.count({ where: { userId } })
    if (count >= FREE_LIMITS.sources) {
      throw AppError.upgradeRequired(`Im Free-Tarif sind maximal ${FREE_LIMITS.sources} Quellen möglich`, {
        feature: 'unlimitedSources',
        limit: FREE_LIMITS.sources,
        used: count,
      })
    }
  }
  const portfolioId = await resolvePortfolioId(userId, input.portfolioId)
  if (input.type === 'MANUAL') {
    const source = await prisma.portfolioSource.create({
      data: { userId, portfolioId, type: 'MANUAL', provider: 'MANUAL', label: input.label },
    })
    return reloadDto(source.id)
  }

  if (input.type === 'EXCHANGE') {
    const provider = getExchangeProvider(input.provider)
    try {
      await provider.validateCredentials({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        passphrase: input.passphrase,
      })
    } catch (e) {
      if (e instanceof ProviderError) throw AppError.badRequest(e.code, e.message)
      throw e
    }
    const source = await prisma.portfolioSource.create({
      data: {
        userId,
        portfolioId,
        type: 'EXCHANGE',
        provider: input.provider,
        label: input.label,
        credential: {
          create: {
            encryptedApiKey: encryptSecret(input.apiKey),
            encryptedApiSecret: input.apiSecret ? encryptSecret(input.apiSecret) : null,
            encryptedPassphrase: input.passphrase ? encryptSecret(input.passphrase) : null,
            keyPreview: keyPreview(input.apiKey),
          },
        },
      },
    })
    return reloadDto(source.id)
  }

  // WALLET
  const provider = getWalletProvider(input.provider)
  if (!provider.validateAddress(input.address)) {
    throw AppError.badRequest('INVALID_ADDRESS', 'Die Wallet-Adresse ist ungültig')
  }
  const source = await prisma.portfolioSource.create({
    data: {
      userId,
      portfolioId,
      type: 'WALLET',
      provider: input.provider,
      label: input.label,
      wallet: {
        create: {
          chain: input.provider.toLowerCase(),
          address: input.address,
          includeUnknownTokens: input.includeUnknownTokens,
        },
      },
    },
  })
  return reloadDto(source.id)
}

export async function updateSource(userId: string, sourceId: string, label: string): Promise<SourceDto> {
  await getOwnedSource(userId, sourceId)
  await prisma.portfolioSource.update({ where: { id: sourceId }, data: { label } })
  return reloadDto(sourceId)
}

export async function deleteSource(userId: string, sourceId: string): Promise<void> {
  await getOwnedSource(userId, sourceId)
  // Holdings, credentials, sync runs etc. cascade off via onDelete: Cascade
  await prisma.portfolioSource.delete({ where: { id: sourceId } })
}
