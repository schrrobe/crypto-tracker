import request from 'supertest'
import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  API,
  app,
  bearer,
  createExchangeSource,
  createManualSource,
  registerUser,
  uploadCsv,
  type TestUser,
} from './helpers'

// FAKE_PROVIDERS: Kraken fake syncs 0.1 BTC + 2 ETH; fake prices BTC 50,000 € / ETH 3,000 €.

interface Group {
  day: string
  sourceId: string
  asset: { symbol: string }
  accountType: string
  kind: string
  origin: string
  delta: string
  quantityAfter: string
  valueEur: string | null
  count: number
}

async function getMovements(user: TestUser, query = ''): Promise<{ groups: Group[]; historyDays: number; hasMore: boolean }> {
  const res = await request(app).get(`${API}/movements${query}`).set(...bearer(user))
  expect(res.status).toBe(200)
  return res.body
}

async function btcAssetId(user: TestUser): Promise<string> {
  const assets = await request(app).get(`${API}/assets/search?q=bitcoin`).set(...bearer(user))
  return assets.body.assets[0].id as string
}

function sync(user: TestUser, sourceId: string) {
  return request(app).post(`${API}/sources/${sourceId}/sync`).set(...bearer(user)).expect(200)
}

describe('Bestandsbewegungen (Integration)', () => {
  it('erster Sync bucht Anfangsbestand, identischer Re-Sync bucht nichts', async () => {
    const user = await registerUser('mv-opening')
    const source = await createExchangeSource(user, 'Kraken Auszug')

    await sync(user, source.id)
    await sync(user, source.id)

    const rows = await prisma.holdingMovement.findMany({ where: { sourceId: source.id } })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.kind === 'OPENING' && r.origin === 'SYNC')).toBe(true)
    expect(rows.every((r) => r.syncRunId !== null)).toBe(true)

    const { groups } = await getMovements(user)
    const btc = groups.find((g) => g.asset.symbol === 'BTC')!
    expect(btc).toMatchObject({ kind: 'OPENING', delta: '0.1', quantityAfter: '0.1', valueEur: '5000.00', count: 1 })
  })

  it('späterer Sync bucht nur die Differenz (Zugang, Abgang auf 0)', async () => {
    const user = await registerUser('mv-diff')
    const source = await createExchangeSource(user, 'Kraken Diff')
    await sync(user, source.id)

    // Simulate a provider state change: locally BTC was 0.08, and a stray SOL
    // holding existed that the provider no longer reports.
    const btc = await prisma.holding.findFirstOrThrow({ where: { sourceId: source.id, asset: { symbol: 'BTC' } } })
    await prisma.holding.update({ where: { id: btc.id }, data: { quantity: new Prisma.Decimal('0.08') } })
    const stray = await prisma.asset.create({ data: { symbol: 'STRAY', name: 'Stray Token' } })
    await prisma.holding.create({ data: { sourceId: source.id, assetId: stray.id, quantity: new Prisma.Decimal('3') } })

    await sync(user, source.id)

    const changes = await prisma.holdingMovement.findMany({
      where: { sourceId: source.id, kind: 'CHANGE' },
      include: { asset: true },
    })
    expect(changes.map((c) => c.asset.symbol).sort()).toEqual(['BTC', 'STRAY'])
    const btcChange = changes.find((c) => c.asset.symbol === 'BTC')!
    const strayChange = changes.find((c) => c.asset.symbol === 'STRAY')!
    expect(btcChange.delta.toString()).toBe('0.02')
    expect(btcChange.quantityBefore.toString()).toBe('0.08')
    expect(strayChange.delta.toString()).toBe('-3')
    expect(strayChange.quantityAfter.toString()).toBe('0')
  })

  it('manuelle Änderungen buchen MANUAL; Summe der Deltas = aktueller Bestand; Tag wird netto gruppiert', async () => {
    const user = await registerUser('mv-manual')
    const source = await createManualSource(user, 'Hardware Wallet')
    const assetId = await btcAssetId(user)

    const created = await request(app)
      .post(`${API}/sources/${source.id}/holdings`)
      .set(...bearer(user))
      .send({ assetId, quantity: '1' })
      .expect(201)
    const holdingId = created.body.holding.id
    for (const quantity of ['1.2', '1.5']) {
      await request(app)
        .patch(`${API}/sources/${source.id}/holdings/${holdingId}`)
        .set(...bearer(user))
        .send({ quantity })
        .expect(200)
    }

    const rows = await prisma.holdingMovement.findMany({ where: { sourceId: source.id } })
    expect(rows.every((r) => r.origin === 'MANUAL' && r.kind === 'CHANGE')).toBe(true)
    const sum = rows.reduce((acc, r) => acc.add(r.delta), new Prisma.Decimal(0))
    expect(sum.toString()).toBe('1.5')

    const { groups } = await getMovements(user, `?sourceId=${source.id}`)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ delta: '1.5', quantityAfter: '1.5', count: 3, valueEur: '75000.00' })

    await request(app).delete(`${API}/sources/${source.id}/holdings/${holdingId}`).set(...bearer(user)).expect(204)
    const last = await prisma.holdingMovement.findFirstOrThrow({
      where: { sourceId: source.id },
      orderBy: { at: 'desc' },
    })
    expect(last.delta.toString()).toBe('-1.5')
    expect(last.quantityAfter.toString()).toBe('0')
  })

  it('erster CSV-Bestandsimport bucht Anfangsbestand mit Herkunft IMPORT', async () => {
    const user = await registerUser('mv-csv')
    const upload = await uploadCsv(user, 'Coin,Amount\nBTC,0.3\n', 'BALANCES')
    await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({ mapping: { symbol: 'Coin', quantity: 'Amount' } })
      .expect(200)

    const rows = await prisma.holdingMovement.findMany({ where: { sourceId: upload.import.sourceId } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'OPENING', origin: 'IMPORT' })
    expect(rows[0]!.delta.toString()).toBe('0.3')
  })

  it('Plan-Fenster: Free sieht 30 Tage, Pro 365 Tage', async () => {
    const user = await registerUser('mv-window', 'FREE')
    const source = await createManualSource(user, 'Alt')
    const assetId = await btcAssetId(user)
    await prisma.holdingMovement.create({
      data: {
        sourceId: source.id,
        assetId,
        accountType: 'SPOT',
        kind: 'CHANGE',
        origin: 'MANUAL',
        quantityBefore: new Prisma.Decimal(0),
        quantityAfter: new Prisma.Decimal(1),
        delta: new Prisma.Decimal(1),
        at: new Date(Date.now() - 60 * 24 * 3600 * 1000),
      },
    })

    const free = await getMovements(user)
    expect(free.historyDays).toBe(30)
    expect(free.groups).toHaveLength(0)

    await prisma.user.update({ where: { id: user.userId }, data: { plan: 'PRO' } })
    const pro = await getMovements(user)
    expect(pro.historyDays).toBe(365)
    expect(pro.groups).toHaveLength(1)
  })

  it('Tagesgrenzen folgen der Zeitzone des Betrachters', async () => {
    const user = await registerUser('mv-tz')
    const source = await createManualSource(user, 'TZ')
    const assetId = await btcAssetId(user)
    const base = new Date()
    base.setUTCDate(base.getUTCDate() - 2)
    const day = base.toISOString().slice(0, 10)
    const at = (time: string) => new Date(`${day}T${time}Z`)
    const row = (when: Date, before: string, after: string) => ({
      sourceId: source.id,
      assetId,
      accountType: 'SPOT' as const,
      kind: 'CHANGE' as const,
      origin: 'MANUAL' as const,
      quantityBefore: new Prisma.Decimal(before),
      quantityAfter: new Prisma.Decimal(after),
      delta: new Prisma.Decimal(after).sub(before),
      at: when,
    })
    // 23:30 UTC and (next day) 00:30 UTC → same Berlin day, different UTC days
    const next = new Date(at('00:30:00').getTime() + 24 * 3600 * 1000)
    await prisma.holdingMovement.createMany({ data: [row(at('23:30:00'), '0', '1'), row(next, '1', '3')] })

    const utc = await getMovements(user, '?tz=UTC')
    expect(utc.groups).toHaveLength(2)
    const berlin = await getMovements(user, '?tz=Europe/Berlin')
    expect(berlin.groups).toHaveLength(1)
    expect(berlin.groups[0]).toMatchObject({ delta: '3', quantityAfter: '3', count: 2 })

    const bad = await request(app).get(`${API}/movements?tz=Mars/Olympus`).set(...bearer(user))
    expect(bad.status).toBe(400)
  })

  it('Assets ohne Kurs (Spam) sind standardmäßig ausgeblendet', async () => {
    const user = await registerUser('mv-spam')
    const source = await createManualSource(user, 'Spam')
    const spam = await prisma.asset.create({ data: { symbol: `SPAM${Date.now()}`, name: 'Free Airdrop' } })
    await request(app)
      .post(`${API}/sources/${source.id}/holdings`)
      .set(...bearer(user))
      .send({ assetId: spam.id, quantity: '1000' })
      .expect(201)

    expect((await getMovements(user)).groups).toHaveLength(0)
    const all = await getMovements(user, '?includeUnpriced=true')
    expect(all.groups).toHaveLength(1)
    expect(all.groups[0]!.valueEur).toBeNull()
  })

  it('fremde Quelle → 404, fremde Bewegungen unsichtbar, Löschen der Quelle entfernt Bewegungen', async () => {
    const alice = await registerUser('mv-alice')
    const bob = await registerUser('mv-bob')
    const source = await createExchangeSource(alice, 'Alice Kraken')
    await sync(alice, source.id)

    const foreign = await request(app).get(`${API}/movements?sourceId=${source.id}`).set(...bearer(bob))
    expect(foreign.status).toBe(404)
    expect((await getMovements(bob)).groups).toHaveLength(0)

    await request(app).delete(`${API}/sources/${source.id}`).set(...bearer(alice)).expect(204)
    expect(await prisma.holdingMovement.count({ where: { sourceId: source.id } })).toBe(0)
  })
})
