import type { Portfolio, Prisma } from '@prisma/client'
import type { PortfolioDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

const DEFAULT_LABEL = 'Mein Portfolio'

type PortfolioWithCount = Prisma.PortfolioGetPayload<{ include: { _count: { select: { sources: true } } } }>

function toPortfolioDto(p: PortfolioWithCount): PortfolioDto {
  return {
    id: p.id,
    label: p.label,
    isDefault: p.isDefault,
    sourceCount: p._count.sources,
    createdAt: p.createdAt.toISOString(),
  }
}

// Wirft 404 statt 403 bei fremden Portfolios — verrät nicht, dass die ID existiert
export async function getOwnedPortfolio(userId: string, portfolioId: string): Promise<Portfolio> {
  const portfolio = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId } })
  if (!portfolio) throw AppError.notFound('Portfolio nicht gefunden')
  return portfolio
}

// Kompatibilitäts-Auflösung für alle gescopten Endpunkte: explizite ID →
// Ownership-Check, keine ID → Default-Portfolio. Lazy-Anlage als Netz für
// direkt geseedete User (Registrierung legt den Default eager an).
export async function resolvePortfolioId(userId: string, portfolioId?: string): Promise<string> {
  if (portfolioId) {
    const portfolio = await getOwnedPortfolio(userId, portfolioId)
    return portfolio.id
  }
  const existing = await prisma.portfolio.findFirst({ where: { userId, isDefault: true } })
  if (existing) return existing.id
  const created = await prisma.portfolio.create({
    data: { userId, label: DEFAULT_LABEL, isDefault: true },
  })
  return created.id
}

export async function listPortfolios(userId: string): Promise<PortfolioDto[]> {
  // Default sicherstellen, damit die Liste nie leer ist
  await resolvePortfolioId(userId)
  const portfolios = await prisma.portfolio.findMany({
    where: { userId },
    include: { _count: { select: { sources: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return portfolios.map(toPortfolioDto)
}

export async function createPortfolio(userId: string, label: string): Promise<PortfolioDto> {
  const portfolio = await prisma.portfolio.create({
    data: { userId, label },
    include: { _count: { select: { sources: true } } },
  })
  return toPortfolioDto(portfolio)
}

export async function renamePortfolio(
  userId: string,
  portfolioId: string,
  label: string,
): Promise<PortfolioDto> {
  await getOwnedPortfolio(userId, portfolioId)
  const portfolio = await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { label },
    include: { _count: { select: { sources: true } } },
  })
  return toPortfolioDto(portfolio)
}

// Kein Cascade: ein Portfolio ist die komplette Steuerhistorie eines
// Steuersubjekts. Löschen nur, wenn leer und nicht das letzte; beim Löschen
// des Defaults wird das älteste verbleibende zum neuen Default.
export async function deletePortfolio(userId: string, portfolioId: string): Promise<void> {
  const portfolio = await getOwnedPortfolio(userId, portfolioId)

  const sourceCount = await prisma.portfolioSource.count({ where: { portfolioId } })
  if (sourceCount > 0) {
    throw AppError.conflict(
      'PORTFOLIO_NOT_EMPTY',
      'Das Portfolio enthält noch Quellen — bitte zuerst die Quellen löschen',
    )
  }
  const total = await prisma.portfolio.count({ where: { userId } })
  if (total <= 1) {
    throw AppError.conflict('PORTFOLIO_LAST', 'Das letzte Portfolio kann nicht gelöscht werden')
  }

  await prisma.$transaction(async (tx) => {
    await tx.portfolio.delete({ where: { id: portfolioId } })
    if (portfolio.isDefault) {
      const oldest = await tx.portfolio.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
      if (oldest) await tx.portfolio.update({ where: { id: oldest.id }, data: { isDefault: true } })
    }
  })
}
