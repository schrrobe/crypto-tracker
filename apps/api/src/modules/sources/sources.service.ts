import type { PortfolioSource } from '@prisma/client'
import type { SourceDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

export function toSourceDto(source: PortfolioSource): SourceDto {
  return {
    id: source.id,
    type: source.type,
    provider: source.provider,
    label: source.label,
    lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
  }
}

export async function listSources(userId: string): Promise<SourceDto[]> {
  const sources = await prisma.portfolioSource.findMany({
    where: { userId },
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

export async function createManualSource(userId: string, label: string): Promise<SourceDto> {
  const source = await prisma.portfolioSource.create({
    data: { userId, type: 'MANUAL', provider: 'MANUAL', label },
  })
  return toSourceDto(source)
}

export async function updateSource(userId: string, sourceId: string, label: string): Promise<SourceDto> {
  await getOwnedSource(userId, sourceId)
  const source = await prisma.portfolioSource.update({ where: { id: sourceId }, data: { label } })
  return toSourceDto(source)
}

export async function deleteSource(userId: string, sourceId: string): Promise<void> {
  await getOwnedSource(userId, sourceId)
  // Holdings, Credentials, SyncRuns etc. hängen per onDelete: Cascade dran
  await prisma.portfolioSource.delete({ where: { id: sourceId } })
}
