import type { Portfolio, Prisma } from '@prisma/client'
import { FREE_LIMITS, type PortfolioDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { getPlan } from '../../middleware/plan.middleware'

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

// Throws 404 instead of 403 for foreign portfolios — does not reveal that the ID exists
export async function getOwnedPortfolio(userId: string, portfolioId: string): Promise<Portfolio> {
  const portfolio = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId } })
  if (!portfolio) throw AppError.notFound('Portfolio nicht gefunden')
  return portfolio
}

// Compatibility resolution for all scoped endpoints: explicit ID →
// ownership check, no ID → default portfolio. Lazy creation as a safety net for
// directly seeded users (registration creates the default eagerly).
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
  // Ensure a default exists so the list is never empty
  await resolvePortfolioId(userId)
  const portfolios = await prisma.portfolio.findMany({
    where: { userId },
    include: { _count: { select: { sources: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return portfolios.map(toPortfolioDto)
}

export async function createPortfolio(userId: string, label: string): Promise<PortfolioDto> {
  // Free limit: at most FREE_LIMITS.portfolios portfolios
  if ((await getPlan(userId)) !== 'PRO') {
    const count = await prisma.portfolio.count({ where: { userId } })
    if (count >= FREE_LIMITS.portfolios) {
      throw AppError.upgradeRequired(`Im Free-Tarif sind maximal ${FREE_LIMITS.portfolios} Portfolios möglich`, {
        feature: 'unlimitedPortfolios',
        limit: FREE_LIMITS.portfolios,
        used: count,
      })
    }
  }
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

// No cascade: a portfolio is the complete tax history of a tax subject.
// Delete only when empty and not the last one; when deleting the default,
// the oldest remaining one becomes the new default.
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
