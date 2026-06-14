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
    // Secrets nur hier, unmittelbar vor dem Call, entschlüsseln
    const creds = {
      apiKey: decryptSecret(credential.encryptedApiKey),
      apiSecret: credential.encryptedApiSecret ? decryptSecret(credential.encryptedApiSecret) : undefined,
      passphrase: credential.encryptedPassphrase ? decryptSecret(credential.encryptedPassphrase) : undefined,
    }
    // Multi-Konto-Provider liefern Spot + Earn/Margin + Futures + Warnungen,
    // sonst Spot-only (Bestände gelten dann als SPOT)
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

// Staking-Rewards des Wallets als STAKING_REWARD-Transaktionen persistieren.
// Idempotent über externalRef (unique + skipDuplicates), inkrementell ab der
// jüngsten bekannten Reward-Ref. Kurs bleibt leer — der Steuerreport ergänzt
// den EUR-Tagespreis per Backfill.
async function importStakingRewards(source: PortfolioSource): Promise<void> {
  try {
    const provider = getWalletProvider(source.provider)
    if (!provider.fetchStakingRewards) return
    const wallet = await prisma.walletAddress.findUnique({ where: { sourceId: source.id } })
    if (!wallet) return

    const last = await prisma.transaction.findFirst({
      where: { sourceId: source.id, externalRef: { not: null } },
      orderBy: { timestamp: 'desc' },
      select: { externalRef: true },
    })
    const rewards = await provider.fetchStakingRewards(wallet.address, {
      lastExternalRef: last?.externalRef ?? null,
    })
    if (rewards.length === 0) return

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
  } catch (error) {
    // Rewards sind Zusatzinformation — der Bestands-Sync bleibt davon unberührt
    console.warn(
      `Staking-Reward-Import für Quelle ${source.id} fehlgeschlagen:`,
      error instanceof Error ? error.message : error,
    )
  }
}

// Schritt 1: Validierung + Run anlegen (RUNNING). Getrennt von der Ausführung,
// damit der Queue-Modus den Run sofort zurückgeben und die Arbeit an den
// Worker übergeben kann.
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

// Schritt 2: Run ausführen — bewusst ohne Express-Abhängigkeit (läuft inline
// oder im Queue-Worker). Provider-Fehler landen im SyncRun (status ERROR),
// nicht als HTTP-Fehler. Bereits abgeschlossene Runs sind ein No-op
// (Queue-Retries dürfen nicht doppelt schreiben).
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
    // exakte Null verwerfen, aber negative MARGIN-Bestände (Verbindlichkeit) behalten
    const balances = snapshot.balances.filter((b) => Number(b.amount) !== 0)
    // Bilanz- und Positions-Basis-Symbole gemeinsam auflösen
    const assetMap = await resolveAssetsBySymbol([
      ...balances.map((b) => b.symbol),
      ...snapshot.positions.map((p) => p.baseSymbol),
    ])

    // Gleiche Symbole je Kontotyp zusammenfassen (unique sourceId+assetId+accountType)
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

    // Holdings + Futures-Positionen der Quelle spiegeln exakt den Provider-Stand
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
      prisma.futuresPosition.createMany({ data: positionRows }),
      prisma.portfolioSource.update({ where: { id: sourceId }, data: { lastSyncAt: new Date() } }),
    ])

    // Preis-Fehler sind kein Sync-Fehler (UI zeigt dann ältere Preise)
    await refreshPrices([...new Set([...byKey.values()].map((v) => v.assetId))])

    // On-Chain-Staking-Rewards als Transaktionen — Fehler hier sind kein Sync-Fehler
    if (source.type === 'WALLET') await importStakingRewards(source)

    // Übersprungene Konto-Typen (fehlende Berechtigung) als Teil-Erfolg ausweisen
    const partial = snapshot.warnings.length > 0
    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        errorCode: partial ? 'PARTIAL_SYNC' : null,
        errorMessage: partial ? snapshot.warnings.join('; ') : null,
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

// Inline-Modus (ohne Queue): Start + Ausführung in einem Aufruf — heutiges Verhalten
export async function syncSource(userId: string, sourceId: string): Promise<SyncRunDto> {
  const run = await startSyncRun(userId, sourceId)
  return executeSyncRun(run.id)
}

// Einstieg für die Routen: mit Queue wird nur gestartet und enqueued (Run bleibt
// RUNNING, Frontend pollt /sync-runs), ohne Queue läuft alles inline wie bisher.
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

// Sequenziell (schont Provider-Rate-Limits); ein Fehler bricht die anderen nicht ab
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
        // z.B. SYNC_ALREADY_RUNNING — als Fehler-Run melden statt abzubrechen
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

// Automatischer Sync (Pro): alle syncbaren Quellen von Pro-Nutzern mit
// aktiviertem Auto-Sync anstoßen. Im Worker (Repeatable Job) aufgerufen.
// Mit Redis werden Runs enqueued, ohne Redis (Tests) inline ausgeführt.
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
      // SYNC_ALREADY_RUNNING ist erwartbar (vorheriger Lauf läuft noch) — still
      // überspringen. Alles andere (DB, Entschlüsselung, Provider-Konfig) loggen,
      // sonst bleibt ein dauerhaft kaputter Auto-Sync unsichtbar.
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
