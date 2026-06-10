import { Prisma, type PortfolioSource } from '@prisma/client'
import type { CreateSourceInput, SourceDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { encryptSecret, keyPreview } from '../../lib/crypto'
import { getExchangeProvider, getWalletProvider } from '../../providers/provider.registry'
import { ProviderError } from '../../providers/provider.types'
import { toSyncRunDto } from '../sync/syncRun.mapper'

type SourceWithRelations = Prisma.PortfolioSourceGetPayload<{
  include: { credential: { select: { keyPreview: true } }; wallet: true; syncRuns: true }
}>

const SOURCE_INCLUDE = {
  // Bewusst nur keyPreview — verschlüsselte Secrets verlassen den Service nie
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
    lastSyncRun: source.syncRuns[0] ? toSyncRunDto(source.syncRuns[0]) : null,
  }
}

export async function listSources(userId: string): Promise<SourceDto[]> {
  const sources = await prisma.portfolioSource.findMany({
    where: { userId },
    include: SOURCE_INCLUDE,
    orderBy: { createdAt: 'asc' },
  })
  return sources.map(toSourceDto)
}

// Wirft 404 statt 403 bei fremden Quellen — verrät nicht, dass die ID existiert
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
  if (input.type === 'MANUAL') {
    const source = await prisma.portfolioSource.create({
      data: { userId, type: 'MANUAL', provider: 'MANUAL', label: input.label },
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
        type: 'EXCHANGE',
        provider: input.provider,
        label: input.label,
        credential: {
          create: {
            encryptedApiKey: encryptSecret(input.apiKey),
            encryptedApiSecret: encryptSecret(input.apiSecret),
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
      type: 'WALLET',
      provider: input.provider,
      label: input.label,
      wallet: { create: { chain: input.provider.toLowerCase(), address: input.address } },
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
  // Holdings, Credentials, SyncRuns etc. hängen per onDelete: Cascade dran
  await prisma.portfolioSource.delete({ where: { id: sourceId } })
}
