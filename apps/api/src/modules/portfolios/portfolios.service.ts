import { Prisma, type Portfolio } from '@prisma/client'
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
  return resolveOrCreateDefault(userId)
}

// Write-path resolution: portfolios are separate tax subjects, so a create must
// never land in a silently-guessed entity. With exactly one portfolio the default
// is unambiguous; with several, an omitted portfolioId is rejected (PORTFOLIO_REQUIRED)
// rather than defaulting, so a transaction can't slip into the wrong tax subject.
export async function resolvePortfolioIdForWrite(
  userId: string,
  portfolioId?: string,
): Promise<string> {
  if (portfolioId) {
    const portfolio = await getOwnedPortfolio(userId, portfolioId)
    return portfolio.id
  }
  const count = await prisma.portfolio.count({ where: { userId } })
  if (count > 1) {
    throw AppError.badRequest(
      'PORTFOLIO_REQUIRED',
      'Bitte wähle das Steuersubjekt, zu dem dieser Eintrag gehört',
    )
  }
  // Exactly one entity (or none): use the single existing one — which may be a
  // non-default portfolio — rather than spawning a fresh "Mein Portfolio".
  const only = await prisma.portfolio.findFirst({ where: { userId } })
  return only ? only.id : resolveOrCreateDefault(userId)
}

async function resolveOrCreateDefault(userId: string): Promise<string> {
  const existing = await prisma.portfolio.findFirst({ where: { userId, isDefault: true } })
  if (existing) return existing.id
  try {
    const created = await prisma.portfolio.create({
      data: { userId, label: DEFAULT_LABEL, isDefault: true },
    })
    return created.id
  } catch (error) {
    // Race: two parallel requests both find no default and both insert one →
    // the partial unique index Portfolio_userId_default_key rejects the loser.
    // Re-fetch the winner instead of surfacing a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.portfolio.findFirst({ where: { userId, isDefault: true } })
      if (winner) return winner.id
    }
    throw error
  }
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

// Tax subjects must be tellable apart at a glance (the user picks one at every
// write), so labels are unique per user, case-insensitively. Blocks "Mein
// Portfolio" twice and near-duplicate names.
async function assertLabelAvailable(
  userId: string,
  label: string,
  excludeId?: string,
): Promise<void> {
  const normalized = label.trim().toLowerCase()
  const existing = await prisma.portfolio.findMany({ where: { userId }, select: { id: true, label: true } })
  if (existing.some((p) => p.id !== excludeId && p.label.trim().toLowerCase() === normalized)) {
    throw AppError.conflict(
      'PORTFOLIO_LABEL_DUPLICATE',
      'Es gibt bereits ein Steuersubjekt mit diesem Namen — bitte einen eindeutigen Namen wählen',
    )
  }
}

export async function createPortfolio(userId: string, label: string): Promise<PortfolioDto> {
  // Free limit: at most FREE_LIMITS.portfolios portfolios
  if ((await getPlan(userId)) !== 'PRO') {
    const count = await prisma.portfolio.count({ where: { userId } })
    if (count >= FREE_LIMITS.portfolios) {
      throw AppError.upgradeRequired('Im Free-Tarif sind maximal 2 Portfolios möglich')
    }
  }
  await assertLabelAvailable(userId, label)
  const portfolio = await prisma.portfolio.create({
    data: { userId, label: label.trim() },
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
  await assertLabelAvailable(userId, label, portfolioId)
  const portfolio = await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { label: label.trim() },
    include: { _count: { select: { sources: true } } },
  })
  return toPortfolioDto(portfolio)
}

// No cascade: a portfolio is the complete tax history of a tax subject.
// Delete only when empty and not the last one; when deleting the default,
// the oldest remaining one becomes the new default.
export async function deletePortfolio(userId: string, portfolioId: string): Promise<void> {
  const portfolio = await getOwnedPortfolio(userId, portfolioId)

  // All guards + the delete run in one transaction that first locks the target
  // portfolio row (FOR UPDATE) and takes a per-user advisory lock:
  //  - the row lock conflicts with the FK key-share lock a concurrent source
  //    INSERT takes on the parent, so the source-count check can't be raced
  //    (no new source slips in between the check and the delete);
  //  - the advisory lock serializes concurrent deletes for the same user so two
  //    of them can't both pass the last-portfolio check and wipe the last entity.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
    await tx.$executeRaw`SELECT id FROM "Portfolio" WHERE id = ${portfolioId} FOR UPDATE`

    const sourceCount = await tx.portfolioSource.count({ where: { portfolioId } })
    if (sourceCount > 0) {
      throw AppError.conflict(
        'PORTFOLIO_NOT_EMPTY',
        'Dieses Steuersubjekt enthält noch Quellen. Es ist die vollständige Steuerhistorie und wird nicht automatisch mitgelöscht — bitte zuerst die Quellen entfernen',
      )
    }
    const total = await tx.portfolio.count({ where: { userId } })
    if (total <= 1) {
      throw AppError.conflict(
        'PORTFOLIO_LAST',
        'Das letzte Steuersubjekt kann nicht gelöscht werden — es muss immer eines geben',
      )
    }
    await tx.portfolio.delete({ where: { id: portfolioId } })
    if (portfolio.isDefault) {
      const oldest = await tx.portfolio.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
      if (oldest) await tx.portfolio.update({ where: { id: oldest.id }, data: { isDefault: true } })
    }
  })
}
