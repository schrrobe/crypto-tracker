import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { API, app, bearer, createExchangeSource, createManualSource, registerUser } from './helpers'

// FAKE_PROVIDERS (Kraken = Spot-only-Fake): Sync liefert 0.1 BTC + 2 ETH ·
// apiKey "SYNCFAIL…" → fetchBalances wirft. (Multi-Konto: account-types.integration)

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
    expect(symbols).toEqual(['BTC', 'ETH']) // exakt einmal, trotz zweier Syncs

    const btc = holdings.body.holdings.find((h: { asset: { symbol: string } }) => h.asset.symbol === 'BTC')
    expect(btc.quantity).toBe('0.1')
    // Fake-Preis BTC 50.000 € → 0.1 BTC = 5.000 €
    expect(btc.valueEur).toBe('5000.00')
  })

  it('Provider-Fehler landet als ERROR-Run mit errorCode, Holdings bleiben unangetastet', async () => {
    const user = await registerUser('syncfail')
    const source = await createExchangeSource(user, 'Wackelig', 'SYNCFAIL-key')

    const res = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(res.status).toBe(200) // Sync-Fehler sind kein HTTP-Fehler
    expect(res.body.run.status).toBe('ERROR')
    expect(res.body.run.errorCode).toBe('PROVIDER_ERROR')

    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    expect(holdings.body.holdings).toHaveLength(0)

    // Run ist in der Historie nachvollziehbar
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

    // die gute Quelle hat trotz Fehler der anderen synchronisiert
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

// Queue-Vorbereitung: Start und Ausführung sind getrennt (Worker ruft executeSyncRun)
describe('Sync-Split: startSyncRun / executeSyncRun', () => {
  it('startSyncRun legt RUNNING-Run an, executeSyncRun schließt ab und schreibt Holdings', async () => {
    const { startSyncRun, executeSyncRun } = await import('../modules/sync/sync.service')
    const user = await registerUser('syncsplit')
    const source = await createExchangeSource(user, 'Split Exchange')

    const started = await startSyncRun(user.userId, source.id)
    expect(started.status).toBe('RUNNING')

    // laufender Run blockiert einen zweiten Start (409 über die Route)
    const second = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('SYNC_ALREADY_RUNNING')

    const finished = await executeSyncRun(started.id)
    expect(finished.status).toBe('SUCCESS')

    // abgeschlossener Run ist idempotent (Queue-Retry darf nicht doppelt schreiben)
    const repeated = await executeSyncRun(started.id)
    expect(repeated.status).toBe('SUCCESS')
    expect(repeated.finishedAt).toBe(finished.finishedAt)

    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    expect(holdings.body.holdings.length).toBeGreaterThan(0)
  })
})
