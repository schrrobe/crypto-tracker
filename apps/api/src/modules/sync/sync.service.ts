import { Prisma, type HoldingAccountType, type PortfolioSource } from '@prisma/client'
import { toSyncRunDto } from './syncRun.mapper'
import type { SyncRunDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { decryptSecret } from '../../lib/crypto'
import { getExchangeProvider, getWalletProvider } from '../../providers/provider.registry'
import { ProviderError, type RawBalance, type RawPosition } from '../../providers/provider.types'
import { resolveAssetsBySymbol } from '../assets/asset-resolution.service'
import { refreshPrices } from '../../coingecko/price.service'
import { getOwnedSource } from '../sources/sources.service'
import { enqueueSyncRun, isQueueEnabled } from './sync.queue'
import { resolvePortfolioId } from '../portfolios/portfolios.service'

const RUNNING_STALE_MS = 2 * 60 * 1000
const FETCH_TIMEOUT_MS = 30 * 1000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ProviderError('PROVIDER_ERROR', 'Zeitüberschreitung beim Anbieter')), ms),
    ),
  ])
}

interface SourceSnapshot {
  balances: RawBalance[]
  positions: RawPosition[]
  warnings: string[]
}

async function fetchSnapshotForSource(source: PortfolioSource): Promise<SourceSnapshot> {
  if (source.type === 'EXCHANGE') {
    const credential = await prisma.exchangeCredential.findUnique({ where: { sourceId: source.id } })
    if (!credential) throw new ProviderError('INVALID_API_KEY', 'Keine Zugangsdaten hinterlegt')
    const provider = getExchangeProvider(source.provider)
    // Decrypt secrets only here, immediately before the call
    const creds = {
      apiKey: decryptSecret(credential.encryptedApiKey),
      apiSecret: credential.encryptedApiSecret ? decryptSecret(credential.encryptedApiSecret) : undefined,
      passphrase: credential.encryptedPassphrase ? decryptSecret(credential.encryptedPassphrase) : undefined,
    }
    // Multi-account providers return spot + earn/margin + futures + warnings,
    // otherwise spot-only (balances then count as SPOT)
    if (provider.fetchAccount) {
      const snap = await withTimeout(provider.fetchAccount(creds), FETCH_TIMEOUT_MS)
      return { balances: snap.balances, positions: snap.positions ?? [], warnings: snap.warnings ?? [] }
    }
    return { balances: await withTimeout(provider.fetchBalances(creds), FETCH_TIMEOUT_MS), positions: [], warnings: [] }
  }
  if (source.type === 'WALLET') {
    const wallet = await prisma.walletAddress.findUnique({ where: { sourceId: source.id } })
    if (!wallet) throw new ProviderError('INVALID_ADDRESS', 'Keine Wallet-Adresse hinterlegt')
    const provider = getWalletProvider(source.provider)
    const balances = await withTimeout(
      provider.fetchBalances(wallet.address, { includeUnknownTokens: wallet.includeUnknownTokens }),
      FETCH_TIMEOUT_MS,
    )
    return { balances, positions: [], warnings: [] }
  }
  throw AppError.badRequest('SOURCE_NOT_SYNCABLE', 'Diese Quelle hat keinen Sync')
}

// Integer tail of a chain externalRef (eth-wd:<index>, sol-reward:<acct>:<epoch>);
// -1 when absent so it never wins the max comparison. Used to pick the incremental
// cursor by the highest index/epoch rather than by the (coarse, tie-prone) timestamp.
function refTail(ref: string): number {
  const n = Number(ref.slice(ref.lastIndexOf(':') + 1))
  return Number.isFinite(n) ? n : -1
}

// Persist the wallet's staking rewards as STAKING_REWARD transactions.
// Idempotent via (sourceId, externalRef) (unique + skipDuplicates), incremental
// from the highest known reward ref. Price stays empty — the tax report adds the
// EUR daily price via backfill. Returns warnings (e.g. provider unavailable) so the
// run is flagged PARTIAL_SYNC instead of silently reporting a full success while
// staking income is missing.
async function importStakingRewards(source: PortfolioSource): Promise<string[]> {
  const provider = getWalletProvider(source.provider)
  if (!provider.fetchStakingRewards) return []
  const wallet = await prisma.walletAddress.findUnique({ where: { sourceId: source.id } })
  if (!wallet) return []

  // Cursor = the highest reward index/epoch seen (integer tail of the externalRef).
  // Reward timestamps are coarse and tie, so ordering by them is not monotonic.
  const refs = await prisma.transaction.findMany({
    where: { sourceId: source.id, externalRef: { not: null } },
    select: { externalRef: true },
  })
  const lastExternalRef = refs.reduce<string | null>((best, { externalRef }) => {
    if (externalRef === null) return best
    if (best === null) return externalRef
    return refTail(externalRef) > refTail(best) ? externalRef : best
  }, null)

  let rewards
  try {
    rewards = await provider.fetchStakingRewards(wallet.address, { lastExternalRef })
  } catch (error) {
    if (error instanceof ProviderError) {
      // Provider failure → rewards incomplete. Nothing is persisted, so the cursor
      // does not advance; the gap is retried from the same point on the next sync.
      // Flag the run PARTIAL_SYNC so the user knows staking income may be stale.
      return [`Staking-Rewards unvollständig (${error.code}) — erneuter Sync nötig`]
    }
    throw error
  }
  if (rewards.length === 0) return []

  const assetMap = await resolveAssetsBySymbol(rewards.map((r) => r.symbol))
  const data = rewards.flatMap((r) => {
    const asset = assetMap.get(r.symbol.toUpperCase())
    if (!asset) return []
    return [
      {
        sourceId: source.id,
        assetId: asset.id,
        type: 'STAKING_REWARD' as const,
        quantity: new Prisma.Decimal(r.amount),
        timestamp: r.timestamp,
        externalRef: r.externalRef,
      },
    ]
  })
  if (data.length > 0) await prisma.transaction.createMany({ data, skipDuplicates: true })
  return []
}

// Step 1: validation + create the run (RUNNING). Separated from execution
// so the queue mode can return the run immediately and hand the work off to
// the worker.
export async function startSyncRun(userId: string, sourceId: string): Promise<SyncRunDto> {
  const source = await getOwnedSource(userId, sourceId)
  if (source.type !== 'EXCHANGE' && source.type !== 'WALLET') {
    throw AppError.badRequest('SOURCE_NOT_SYNCABLE', 'Nur Exchange- und Wallet-Quellen können synchronisiert werden')
  }

  const running = await prisma.syncRun.findFirst({
    where: { sourceId, status: 'RUNNING', startedAt: { gt: new Date(Date.now() - RUNNING_STALE_MS) } },
  })
  if (running) {
    throw AppError.conflict('SYNC_ALREADY_RUNNING', 'Für diese Quelle läuft bereits ein Sync')
  }

  const run = await prisma.syncRun.create({ data: { sourceId, status: 'RUNNING' } })
  return toSyncRunDto(run)
}

// Step 2: execute the run — deliberately without an Express dependency (runs inline
// or in the queue worker). Provider errors land in the SyncRun (status ERROR),
// not as an HTTP error. Already finished runs are a no-op
// (queue retries must not write twice).
export async function executeSyncRun(runId: string): Promise<SyncRunDto> {
  const run = await prisma.syncRun.findUnique({
    where: { id: runId },
    include: { source: true },
  })
  if (!run) throw AppError.notFound('SyncRun nicht gefunden')
  if (run.status !== 'RUNNING') return toSyncRunDto(run)

  const source = run.source
  const sourceId = source.id

  try {
    const snapshot = await fetchSnapshotForSource(source)
    // discard exact zero, but keep negative MARGIN balances (a liability)
    const balances = snapshot.balances.filter((b) => Number(b.amount) !== 0)
    // resolve balance and position base symbols together
    const assetMap = await resolveAssetsBySymbol([
      ...balances.map((b) => b.symbol),
      ...snapshot.positions.map((p) => p.baseSymbol),
    ])

    // Combine identical symbols per account type (unique sourceId+assetId+accountType)
    const byKey = new Map<string, { assetId: string; accountType: HoldingAccountType; quantity: Prisma.Decimal }>()
    for (const balance of balances) {
      const asset = assetMap.get(balance.symbol.toUpperCase())
      if (!asset) continue
      const accountType: HoldingAccountType = balance.accountType ?? 'SPOT'
      const key = `${asset.id}|${accountType}`
      const prev = byKey.get(key)
      if (prev) prev.quantity = prev.quantity.add(new Prisma.Decimal(balance.amount))
      else byKey.set(key, { assetId: asset.id, accountType, quantity: new Prisma.Decimal(balance.amount) })
    }

    const positionRows = snapshot.positions.map((p) => ({
      sourceId,
      assetId: assetMap.get(p.baseSymbol.toUpperCase())?.id ?? null,
      rawSymbol: p.rawSymbol,
      side: p.side,
      size: new Prisma.Decimal(p.size),
      entryPrice: p.entryPrice ? new Prisma.Decimal(p.entryPrice) : null,
      markPrice: p.markPrice ? new Prisma.Decimal(p.markPrice) : null,
      leverage: p.leverage ?? null,
      unrealizedPnl: p.unrealizedPnl ? new Prisma.Decimal(p.unrealizedPnl) : null,
      quoteCurrency: p.quoteCurrency ?? null,
      liquidationPrice: p.liquidationPrice ? new Prisma.Decimal(p.liquidationPrice) : null,
    }))

    // The source's holdings + futures positions mirror exactly the provider state
    await prisma.$transaction([
      prisma.holding.deleteMany({ where: { sourceId } }),
      prisma.holding.createMany({
        data: [...byKey.values()].map((v) => ({
          sourceId,
          assetId: v.assetId,
          accountType: v.accountType,
          quantity: v.quantity,
        })),
      }),
      prisma.futuresPosition.deleteMany({ where: { sourceId } }),
      // skipDuplicates: a duplicate (rawSymbol, side) must not roll back the whole
      // sync transaction (holdings + positions + lastSyncAt) via P2002
      prisma.futuresPosition.createMany({ data: positionRows, skipDuplicates: true }),
      prisma.portfolioSource.update({ where: { id: sourceId }, data: { lastSyncAt: new Date() } }),
    ])

    // Price errors are not a sync error (the UI then shows older prices)
    await refreshPrices([...new Set([...byKey.values()].map((v) => v.assetId))])

    // On-chain staking rewards as transactions. The balance sync is already
    // committed, so a provider failure flags the run PARTIAL_SYNC (rewards stale)
    // rather than aborting; an unexpected (non-provider) error still throws → ERROR.
    const rewardWarnings = source.type === 'WALLET' ? await importStakingRewards(source) : []

    // Report skipped account types and incomplete rewards as a partial success
    const warnings = [...snapshot.warnings, ...rewardWarnings]
    const partial = warnings.length > 0
    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        errorCode: partial ? 'PARTIAL_SYNC' : null,
        errorMessage: partial ? warnings.join('; ') : null,
      },
    })
    return toSyncRunDto(finished)
  } catch (error) {
    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'ERROR',
        finishedAt: new Date(),
        errorCode: error instanceof ProviderError ? error.code : 'SYNC_ERROR',
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    })
    return toSyncRunDto(finished)
  }
}

// Inline mode (without queue): start + execution in one call — current behavior
export async function syncSource(userId: string, sourceId: string): Promise<SyncRunDto> {
  const run = await startSyncRun(userId, sourceId)
  return executeSyncRun(run.id)
}

// Entry point for the routes: with a queue it only starts and enqueues (the run stays
// RUNNING, the frontend polls /sync-runs); without a queue everything runs inline as before.
export async function requestSync(
  userId: string,
  sourceId: string,
): Promise<{ run: SyncRunDto; queued: boolean }> {
  if (!isQueueEnabled()) {
    return { run: await syncSource(userId, sourceId), queued: false }
  }
  const run = await startSyncRun(userId, sourceId)
  await enqueueSyncRun(run.id)
  return { run, queued: true }
}

// Sequential (spares provider rate limits); one failure does not abort the others
export async function syncAllSources(
  userId: string,
  portfolioId?: string,
): Promise<{ results: Array<{ sourceId: string; run: SyncRunDto }>; queued: boolean }> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const sources = await prisma.portfolioSource.findMany({
    where: { userId, portfolioId: pid, type: { in: ['EXCHANGE', 'WALLET'] } },
    orderBy: { createdAt: 'asc' },
  })
  const results: Array<{ sourceId: string; run: SyncRunDto }> = []
  for (const source of sources) {
    const run = await requestSync(userId, source.id)
      .then((r) => r.run)
      .catch((e) => {
        // e.g. SYNC_ALREADY_RUNNING — report as an error run instead of aborting
        const message = e instanceof Error ? e.message : String(e)
        return {
          id: 'skipped',
          status: 'ERROR',
          startedAt: new Date().toISOString(),
          finishedAt: null,
          errorCode: 'SKIPPED',
          errorMessage: message,
        } satisfies SyncRunDto
      })
    results.push({ sourceId: source.id, run })
  }
  return { results, queued: isQueueEnabled() }
}

// Automatic sync (Pro): trigger all syncable sources of Pro users with
// auto-sync enabled. Called in the worker (repeatable job).
// With Redis, runs are enqueued; without Redis (tests) they run inline.
export async function enqueueAutoSync(): Promise<{ sources: number; queued: boolean }> {
  const sources = await prisma.portfolioSource.findMany({
    where: {
      type: { in: ['EXCHANGE', 'WALLET'] },
      user: { plan: 'PRO', autoSyncEnabled: true },
    },
    orderBy: { createdAt: 'asc' },
  })
  let count = 0
  for (const source of sources) {
    try {
      await requestSync(source.userId, source.id)
      count += 1
    } catch (error) {
      // SYNC_ALREADY_RUNNING is expected (a previous run is still going) — skip
      // silently. Log everything else (DB, decryption, provider config),
      // otherwise a permanently broken auto-sync stays invisible.
      const code = error instanceof AppError ? error.code : null
      if (code !== 'SYNC_ALREADY_RUNNING') {
        console.warn(
          `[auto-sync] Quelle ${source.id} fehlgeschlagen:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }
  return { sources: count, queued: isQueueEnabled() }
}

export async function listSyncRuns(userId: string, sourceId: string, limit = 20): Promise<SyncRunDto[]> {
  await getOwnedSource(userId, sourceId)
  const runs = await prisma.syncRun.findMany({
    where: { sourceId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
  return runs.map(toSyncRunDto)
}
