import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, createExchangeSource, createManualSource, registerUser } from './helpers'

// FAKE_PROVIDERS (Kraken = spot-only fake): sync returns 0.1 BTC + 2 ETH ·
// apiKey "SYNCFAIL…" → fetchBalances throws. (Multi-account: account-types.integration)

describe('Sync-Flow (Integration)', () => {
  it('Sync ersetzt die Holdings der Quelle vollständig (kein Duplizieren bei Re-Sync)', async () => {
    const user = await registerUser('sync')
    const source = await createExchangeSource(user, 'Sync Exchange')

    const first = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(first.status).toBe(200)
    expect(first.body.run.status).toBe('SUCCESS')

    const again = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(again.body.run.status).toBe('SUCCESS')

    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    const symbols = holdings.body.holdings.map((h: { asset: { symbol: string } }) => h.asset.symbol).sort()
    expect(symbols).toEqual(['BTC', 'ETH']) // exactly once, despite two syncs

    const btc = holdings.body.holdings.find((h: { asset: { symbol: string } }) => h.asset.symbol === 'BTC')
    expect(btc.quantity).toBe('0.1')
    // Fake price BTC 50,000 € → 0.1 BTC = 5,000 €
    expect(btc.valueEur).toBe('5000.00')
  })

  it('Provider-Fehler landet als ERROR-Run mit errorCode, Holdings bleiben unangetastet', async () => {
    const user = await registerUser('syncfail')
    const source = await createExchangeSource(user, 'Wackelig', 'SYNCFAIL-key')

    const res = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(res.status).toBe(200) // sync errors are not HTTP errors
    expect(res.body.run.status).toBe('ERROR')
    expect(res.body.run.errorCode).toBe('PROVIDER_ERROR')

    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    expect(holdings.body.holdings).toHaveLength(0)

    // Run is traceable in the history
    const runs = await request(app).get(`${API}/sources/${source.id}/sync-runs`).set(...bearer(user))
    expect(runs.body.runs[0].status).toBe('ERROR')
  })

  it('manuelle Quellen sind nicht synchronisierbar', async () => {
    const user = await registerUser('syncmanual')
    const source = await createManualSource(user, 'Nur manuell')
    const res = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('SOURCE_NOT_SYNCABLE')
  })

  it('sync-all isoliert Fehler pro Quelle', async () => {
    const user = await registerUser('syncall')
    await createExchangeSource(user, 'Gut')
    await createExchangeSource(user, 'Kaputt', 'SYNCFAIL-key')

    const res = await request(app).post(`${API}/sources/sync-all`).set(...bearer(user))
    const statuses = res.body.results.map((r: { run: { status: string } }) => r.run.status).sort()
    expect(statuses).toEqual(['ERROR', 'SUCCESS'])

    // the good source synced despite the other one's error
    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    expect(holdings.body.holdings.length).toBeGreaterThan(0)
  })

  it('abgelehnter API-Key verhindert schon das Anlegen der Quelle', async () => {
    const user = await registerUser('invalidkey')
    const res = await request(app)
      .post(`${API}/sources`)
      .set(...bearer(user))
      .send({ type: 'EXCHANGE', provider: 'KRAKEN', label: 'Nope', apiKey: 'INVALID-key', apiSecret: 'whatever' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_API_KEY')

    const list = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(list.body.sources).toHaveLength(0)
  })
})

// Queue preparation: start and execution are separated (worker calls executeSyncRun)
describe('Sync-Split: startSyncRun / executeSyncRun', () => {
  it('startSyncRun legt RUNNING-Run an, executeSyncRun schließt ab und schreibt Holdings', async () => {
    const { startSyncRun, executeSyncRun } = await import('../modules/sync/sync.service')
    const user = await registerUser('syncsplit')
    const source = await createExchangeSource(user, 'Split Exchange')

    const started = await startSyncRun(user.userId, source.id)
    expect(started.status).toBe('RUNNING')

    // a running run blocks a second start (409 via the route)
    const second = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('SYNC_ALREADY_RUNNING')

    const finished = await executeSyncRun(started.id)
    expect(finished.status).toBe('SUCCESS')

    // a completed run is idempotent (queue retry must not write twice)
    const repeated = await executeSyncRun(started.id)
    expect(repeated.status).toBe('SUCCESS')
    expect(repeated.finishedAt).toBe(finished.finishedAt)

    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    expect(holdings.body.holdings.length).toBeGreaterThan(0)
  })
})

// Liveness lease: a fresh heartbeat means a live executor owns the run. A second
// executor must no-op (no duplicate side effects) and a second start must be blocked
// even past RUNNING_STALE_MS — only a stale/missing heartbeat frees the source.
describe('Sync-Lease (Heartbeat)', () => {
  it('executeSyncRun no-opt, wenn ein lebender Executor den Run hält (frischer Heartbeat)', async () => {
    const { executeSyncRun } = await import('../modules/sync/sync.service')
    const user = await registerUser('lease-claim')
    const source = await createExchangeSource(user, 'Lease Exchange')

    // Simulate a live executor that has already claimed the run.
    const owned = await prisma.syncRun.create({
      data: { sourceId: source.id, status: 'RUNNING', heartbeatAt: new Date() },
    })

    const result = await executeSyncRun(owned.id)
    expect(result.status).toBe('RUNNING') // claim matched 0 rows → no-op
    expect(result.finishedAt).toBeNull()

    // No side effects ran: holdings were not written by the losing executor.
    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    expect(holdings.body.holdings).toHaveLength(0)
  })

  it('ein langer Run mit frischem Heartbeat blockiert einen zweiten Start, ein toter (alter Heartbeat) nicht', async () => {
    const { startSyncRun } = await import('../modules/sync/sync.service')
    const user = await registerUser('lease-gate')
    const source = await createExchangeSource(user, 'Long Sync')

    // Older than RUNNING_STALE_MS (2 min) but still actively beating → alive.
    const alive = await prisma.syncRun.create({
      data: {
        sourceId: source.id,
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        heartbeatAt: new Date(),
      },
    })
    await expect(startSyncRun(user.userId, source.id)).rejects.toMatchObject({ code: 'SYNC_ALREADY_RUNNING' })

    // Heartbeat goes stale (executor crashed) → the source frees up for a new run.
    await prisma.syncRun.update({
      where: { id: alive.id },
      data: { heartbeatAt: new Date(Date.now() - 5 * 60 * 1000) },
    })
    const restarted = await startSyncRun(user.userId, source.id)
    expect(restarted.status).toBe('RUNNING')
  })
})

// A worker crash (OOM/SIGKILL) can leave a run RUNNING forever — executeSyncRun's
// catch only runs in a live process. The reaper marks such orphans ERROR/STALE.
describe('Stale-Run-Reaper', () => {
  it('markiert hängende RUNNING-Runs als ERROR/STALE, lässt frische in Ruhe', async () => {
    const { reapStaleRuns } = await import('../modules/sync/sync.service')
    const user = await registerUser('reaper')
    const source = await createExchangeSource(user, 'Reaper Exchange')

    const stale = await prisma.syncRun.create({
      data: { sourceId: source.id, status: 'RUNNING', startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
    const fresh = await prisma.syncRun.create({
      data: { sourceId: source.id, status: 'RUNNING' },
    })

    const result = await reapStaleRuns()
    expect(result.reaped).toBeGreaterThanOrEqual(1)

    const reaped = await prisma.syncRun.findUnique({ where: { id: stale.id } })
    expect(reaped?.status).toBe('ERROR')
    expect(reaped?.errorCode).toBe('STALE')
    expect(reaped?.finishedAt).not.toBeNull()

    const untouched = await prisma.syncRun.findUnique({ where: { id: fresh.id } })
    expect(untouched?.status).toBe('RUNNING')
  })
})
