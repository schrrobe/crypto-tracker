import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, createExchangeSource, registerUser, setPlan, type TestUser } from './helpers'

async function findAssetId(user: TestUser, symbol: string): Promise<string> {
  const res = await request(app)
    .get(`${API}/assets/search?q=${symbol}`)
    .set(...bearer(user))
  const asset = (res.body.assets as Array<{ id: string; symbol: string }>).find((a) => a.symbol === symbol)
  if (!asset) throw new Error(`Asset ${symbol} nicht im Seed`)
  return asset.id
}

async function createTx(user: TestUser, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`${API}/transactions`)
    .set(...bearer(user))
    .send(body)
  expect(res.status).toBe(201)
}

async function getReport(user: TestUser, year: number, country: string) {
  return request(app)
    .get(`${API}/tax/report?year=${year}&country=${country}`)
    .set(...bearer(user))
}

describe('Steuerreport (Integration)', () => {
  it('DE-Report: FIFO-Gewinn, Freigrenze, Summen', async () => {
    const user = await registerUser('tax-de')
    await setPlan(user, 'PRO') // Steuerreport ist Pro-only
    const btcId = await findAssetId(user, 'BTC')

    await createTx(user, {
      assetId: btcId,
      type: 'BUY',
      quantity: '2',
      pricePerUnit: '20000',
      currency: 'EUR',
      timestamp: '2024-01-15T10:00:00.000Z',
    })
    await createTx(user, {
      assetId: btcId,
      type: 'SELL',
      quantity: '1',
      pricePerUnit: '30000',
      currency: 'EUR',
      timestamp: '2024-06-15T10:00:00.000Z',
    })

    const res = await getReport(user, 2024, 'DE')
    expect(res.status).toBe(200)
    expect(res.body.country).toBe('DE')
    expect(res.body.disposals).toHaveLength(1)
    expect(res.body.disposals[0].gainEur).toBe('10000.00')
    expect(res.body.disposals[0].taxable).toBe(true)
    expect(res.body.disposals[0].regime).toBe('DE_PRIVATE_SALE')
    expect(res.body.disposals[0].priceQuality).toBe('ORIGINAL')
    expect(res.body.totals.taxableGainEur).toBe('10000.00')
    expect(res.body.totals.thresholdEur).toBe('1000.00')
    expect(res.body.totals.thresholdApplied).toBe(true)
    expect(res.body.totals.taxableAfterThresholdEur).toBe('10000.00')

    // anderes Jahr: keine Veräußerungen
    const empty = await getReport(user, 2023, 'DE')
    expect(empty.body.disposals).toHaveLength(0)
  })

  it('AT-Report: Neuvermögen-Topf separat ausgewiesen', async () => {
    const user = await registerUser('tax-at')
    await setPlan(user, 'PRO')
    const ethId = await findAssetId(user, 'ETH')

    await createTx(user, {
      assetId: ethId,
      type: 'BUY',
      quantity: '1',
      pricePerUnit: '1000',
      currency: 'EUR',
      timestamp: '2022-01-15T10:00:00.000Z',
    })
    await createTx(user, {
      assetId: ethId,
      type: 'SELL',
      quantity: '1',
      pricePerUnit: '1400',
      currency: 'EUR',
      timestamp: '2024-06-15T10:00:00.000Z',
    })

    const res = await getReport(user, 2024, 'AT')
    expect(res.status).toBe(200)
    expect(res.body.disposals[0].regime).toBe('AT_NEUVERMOEGEN')
    expect(res.body.disposals[0].taxable).toBe(true)
    expect(res.body.totals.atNeuvermoegenGainEur).toBe('400.00')
    expect(res.body.totals.taxableAfterThresholdEur).toBe('400.00')
  })

  it('Backfill: Transaktion ohne Kurs bekommt Fake-Tagespreis (BACKFILLED)', async () => {
    const user = await registerUser('tax-backfill')
    await setPlan(user, 'PRO')
    const btcId = await findAssetId(user, 'BTC')

    await createTx(user, {
      assetId: btcId,
      type: 'BUY',
      quantity: '1',
      timestamp: '2024-02-01T10:00:00.000Z',
    })
    await createTx(user, {
      assetId: btcId,
      type: 'SELL',
      quantity: '1',
      timestamp: '2024-08-01T10:00:00.000Z',
    })

    const res = await getReport(user, 2024, 'DE')
    expect(res.status).toBe(200)
    expect(res.body.disposals).toHaveLength(1)
    expect(res.body.disposals[0].priceQuality).toBe('BACKFILLED')
    // Fake-Preis steigt übers Jahr → positiver Gewinn, in den Summen enthalten
    expect(Number(res.body.totals.totalGainEur)).toBeGreaterThan(0)
  })

  it('unmapped Asset ohne Kurs: MISSING + Warnungen, Summen bleiben sauber', async () => {
    const user = await registerUser('tax-missing')
    const unmapped = await prisma.asset.create({
      data: { symbol: `TAXX${Date.now()}`, name: 'Tax Test Unmapped', coingeckoId: null },
    })

    await createTx(user, {
      assetId: unmapped.id,
      type: 'BUY',
      quantity: '10',
      timestamp: '2024-01-01T00:00:00.000Z',
    })
    await createTx(user, {
      assetId: unmapped.id,
      type: 'SELL',
      quantity: '10',
      timestamp: '2024-06-01T00:00:00.000Z',
    })

    const res = await getReport(user, 2024, 'DE')
    expect(res.status).toBe(200)
    expect(res.body.disposals[0].priceQuality).toBe('MISSING')
    expect(res.body.totals.totalGainEur).toBe('0.00')
    const codes = res.body.warnings.map((w: { code: string }) => w.code)
    expect(codes).toContain('UNKNOWN_ACQUISITION_BASIS')
    expect(codes).toContain('MISSING_DISPOSAL_PRICE')
  })

  it('Fremdwährungs-Kurs wird verworfen und per Backfill ersetzt (Warnung)', async () => {
    const user = await registerUser('tax-fx')
    const btcId = await findAssetId(user, 'BTC')

    await createTx(user, {
      assetId: btcId,
      type: 'BUY',
      quantity: '1',
      pricePerUnit: '25000',
      currency: 'USD',
      timestamp: '2024-03-01T00:00:00.000Z',
    })
    await createTx(user, {
      assetId: btcId,
      type: 'SELL',
      quantity: '1',
      pricePerUnit: '30000',
      currency: 'EUR',
      timestamp: '2024-09-01T00:00:00.000Z',
    })

    const res = await getReport(user, 2024, 'DE')
    const codes = res.body.warnings.map((w: { code: string }) => w.code)
    expect(codes).toContain('FOREIGN_CURRENCY_PRICE_IGNORED')
    // Verkaufszeile selbst hat Original-Kurs (EUR)
    expect(res.body.disposals[0].priceQuality).toBe('ORIGINAL')
  })

  it('Quellen mit Beständen ohne Transaktionen erscheinen als uncoveredSources', async () => {
    const user = await registerUser('tax-uncovered')
    const source = await createExchangeSource(user, 'Kraken Test')
    // Fake-Sync erzeugt Holdings ohne Transaktionen
    const sync = await request(app)
      .post(`${API}/sources/${source.id}/sync`)
      .set(...bearer(user))
    expect(sync.status).toBe(200)

    const res = await getReport(user, 2024, 'DE')
    expect(res.status).toBe(200)
    const ids = res.body.uncoveredSources.map((s: { id: string }) => s.id)
    expect(ids).toContain(source.id)
  })

  it('Staking-Reward: DE Zufluss-Einkommen mit Freigrenze, AT Basis 0', async () => {
    const user = await registerUser('tax-staking')
    const ethId = await findAssetId(user, 'ETH')

    await createTx(user, {
      assetId: ethId,
      type: 'STAKING_REWARD',
      quantity: '1',
      pricePerUnit: '300',
      currency: 'EUR',
      timestamp: '2024-02-01T00:00:00.000Z',
    })

    const de = await getReport(user, 2024, 'DE')
    expect(de.status).toBe(200)
    expect(de.body.totals.stakingIncomeEur).toBe('300.00')
    expect(de.body.totals.stakingThresholdEur).toBe('256.00')
    expect(de.body.totals.stakingTaxableEur).toBe('300.00')

    // AT: kein Zufluss-Einkommen; Verkauf hätte Basis 0
    const at = await getReport(user, 2024, 'AT')
    expect(at.body.totals.stakingIncomeEur).toBeUndefined()
  })

  it('Validierung: ungültiges Jahr/Land → 400', async () => {
    const user = await registerUser('tax-val')
    expect((await getReport(user, NaN, 'DE')).status).toBe(400)
    expect((await getReport(user, 2024, 'CH')).status).toBe(400)
  })

  it('fremde Daten bleiben unsichtbar: zweiter User sieht leeren Report', async () => {
    const owner = await registerUser('tax-owner')
    const stranger = await registerUser('tax-stranger')
    const btcId = await findAssetId(owner, 'BTC')

    await createTx(owner, {
      assetId: btcId,
      type: 'BUY',
      quantity: '1',
      pricePerUnit: '10000',
      currency: 'EUR',
      timestamp: '2024-01-01T00:00:00.000Z',
    })
    await createTx(owner, {
      assetId: btcId,
      type: 'SELL',
      quantity: '1',
      pricePerUnit: '20000',
      currency: 'EUR',
      timestamp: '2024-06-01T00:00:00.000Z',
    })

    const res = await getReport(stranger, 2024, 'DE')
    expect(res.status).toBe(200)
    expect(res.body.disposals).toHaveLength(0)
    expect(res.body.totals.totalGainEur).toBe('0.00')
  })
})
