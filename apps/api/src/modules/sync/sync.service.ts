import { Prisma, type PortfolioSource } from '@prisma/client'
import { toSyncRunDto } from './syncRun.mapper'
import type { SyncRunDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { decryptSecret } from '../../lib/crypto'
import { getExchangeProvider, getWalletProvider } from '../../providers/provider.registry'
import { ProviderError, type RawBalance } from '../../providers/provider.types'
import { resolveAssetsBySymbol } from '../assets/asset-resolution.service'
import { refreshPrices } from '../../coingecko/price.service'
import { getOwnedSource } from '../sources/sources.service'
import { enqueueSyncRun, isQueueEnabled } from './sync.queue'

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

async function fetchBalancesForSource(source: PortfolioSource): Promise<RawBalance[]> {
  if (source.type === 'EXCHANGE') {
    const credential = await prisma.exchangeCredential.findUnique({ where: { sourceId: source.id } })
    if (!credential) throw new ProviderError('INVALID_API_KEY', 'Keine Zugangsdaten hinterlegt')
    const provider = getExchangeProvider(source.provider)
    // Secrets nur hier, unmittelbar vor dem Call, entschlüsseln
    return withTimeout(
      provider.fetchBalances({
        apiKey: decryptSecret(credential.encryptedApiKey),
        apiSecret: credential.encryptedApiSecret
          ? decryptSecret(credential.encryptedApiSecret)
          : undefined,
        passphrase: credential.encryptedPassphrase
          ? decryptSecret(credential.encryptedPassphrase)
          : undefined,
      }),
      FETCH_TIMEOUT_MS,
    )
  }
  if (source.type === 'WALLET') {
    const wallet = await prisma.walletAddress.findUnique({ where: { sourceId: source.id } })
    if (!wallet) throw new ProviderError('INVALID_ADDRESS', 'Keine Wallet-Adresse hinterlegt')
    const provider = getWalletProvider(source.provider)
    return withTimeout(
      provider.fetchBalances(wallet.address, { includeUnknownTokens: wallet.includeUnknownTokens }),
      FETCH_TIMEOUT_MS,
    )
  }
  throw AppError.badRequest('SOURCE_NOT_SYNCABLE', 'Diese Quelle hat keinen Sync')
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
    const balances = (await fetchBalancesForSource(source)).filter((b) => Number(b.amount) > 0)
    const assetMap = await resolveAssetsBySymbol(balances.map((b) => b.symbol))

    // Gleiche Symbole vom Provider zusammenfassen (unique sourceId+assetId)
    const byAsset = new Map<string, Prisma.Decimal>()
    for (const balance of balances) {
      const asset = assetMap.get(balance.symbol.toUpperCase())
      if (!asset) continue
      const prev = byAsset.get(asset.id) ?? new Prisma.Decimal(0)
      byAsset.set(asset.id, prev.add(new Prisma.Decimal(balance.amount)))
    }

    // Holdings der Quelle spiegeln exakt den Provider-Stand
    await prisma.$transaction([
      prisma.holding.deleteMany({ where: { sourceId } }),
      prisma.holding.createMany({
        data: [...byAsset.entries()].map(([assetId, quantity]) => ({ sourceId, assetId, quantity })),
      }),
      prisma.portfolioSource.update({ where: { id: sourceId }, data: { lastSyncAt: new Date() } }),
    ])

    // Preis-Fehler sind kein Sync-Fehler (UI zeigt dann ältere Preise)
    await refreshPrices([...byAsset.keys()])

    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', finishedAt: new Date() },
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
): Promise<{ results: Array<{ sourceId: string; run: SyncRunDto }>; queued: boolean }> {
  const sources = await prisma.portfolioSource.findMany({
    where: { userId, type: { in: ['EXCHANGE', 'WALLET'] } },
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

export async function listSyncRuns(userId: string, sourceId: string, limit = 20): Promise<SyncRunDto[]> {
  await getOwnedSource(userId, sourceId)
  const runs = await prisma.syncRun.findMany({
    where: { sourceId },
    orderBy: { startedAt: 'desc' },
    take: limit,
  })
  return runs.map(toSyncRunDto)
}
