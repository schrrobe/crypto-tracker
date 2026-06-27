import { Prisma, type PortfolioSource } from '@prisma/client'
import { FREE_LIMITS, type CreateSourceInput, type SourceDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { encryptSecret, keyPreview } from '../../lib/crypto'
import { getPlan } from '../../middleware/plan.middleware'
import { getExchangeProvider, getWalletProvider } from '../../providers/provider.registry'
import { ProviderError } from '../../providers/provider.types'
import { toSyncRunDto } from '../sync/syncRun.mapper'
import { resolvePortfolioId, resolvePortfolioIdForWrite } from '../portfolios/portfolios.service'
import { MANUAL_TX_SOURCE_LABEL } from '../transactions/transactions.service'

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
  // The reserved label belongs to the auto-managed manual-transaction bucket and
  // must not be claimed by a user-created source (would collide on the partial
  // unique index / shadow the auto bucket).
  if (input.type === 'MANUAL' && input.label.trim() === MANUAL_TX_SOURCE_LABEL) {
    throw AppError.badRequest(
      'SOURCE_LABEL_RESERVED',
      'Dieser Name ist für die automatische Quelle „Manuelle Transaktionen" reserviert',
    )
  }
  const plan = await getPlan(userId)
  const portfolioId = await resolvePortfolioIdForWrite(userId, input.portfolioId)

  // Free limit: max. FREE_LIMITS.sources user-created sources. The auto-managed
  // manual-transaction bucket is infrastructure and is excluded from the count.
  // Enforced atomically inside the create tx via a per-user advisory lock, so two
  // concurrent requests can't both pass the count check (TOCTOU) and exceed it.
  // Credential/address validation runs BEFORE the tx so the lock isn't held
  // during slow provider network calls.
  const enforceQuota = async (tx: Prisma.TransactionClient): Promise<void> => {
    if (plan === 'PRO') return
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
    const count = await tx.portfolioSource.count({
      where: { userId, NOT: { type: 'MANUAL', label: MANUAL_TX_SOURCE_LABEL } },
    })
    if (count >= FREE_LIMITS.sources) {
      throw AppError.upgradeRequired(`Im Free-Tarif sind maximal ${FREE_LIMITS.sources} Quellen möglich`, {
        feature: 'unlimitedSources',
        limit: FREE_LIMITS.sources,
        used: count,
      })
    }
  }

  if (input.type === 'MANUAL') {
    const id = await prisma.$transaction(async (tx) => {
      await enforceQuota(tx)
      const source = await tx.portfolioSource.create({
        data: { userId, portfolioId, type: 'MANUAL', provider: 'MANUAL', label: input.label },
      })
      return source.id
    })
    return reloadDto(id)
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
    const id = await prisma.$transaction(async (tx) => {
      await enforceQuota(tx)
      const source = await tx.portfolioSource.create({
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
      return source.id
    })
    return reloadDto(id)
  }

  // WALLET
  const provider = getWalletProvider(input.provider)
  if (!provider.validateAddress(input.address)) {
    throw AppError.badRequest('INVALID_ADDRESS', 'Die Wallet-Adresse ist ungültig')
  }
  const id = await prisma.$transaction(async (tx) => {
    await enforceQuota(tx)
    const source = await tx.portfolioSource.create({
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
    return source.id
  })
  return reloadDto(id)
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
