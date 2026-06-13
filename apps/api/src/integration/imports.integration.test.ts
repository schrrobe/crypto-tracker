import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, createExchangeSource, registerUser, uploadCsv } from './helpers'

// Kraken-Ledger-Header → Preset KRAKEN wird erkannt
const KRAKEN_CSV =
  'txid,refid,time,type,asset,amount,fee,balance\n' +
  'L1,R1,2024-01-01T00:00:00Z,deposit,XXBT,0.5,0,0.5\n'

async function uploadRaw(user: { token: string }, csv: string) {
  const res = await request(app)
    .post(`${API}/imports`)
    .set('Authorization', `Bearer ${user.token}`)
    .field('kind', 'TRANSACTIONS')
    .attach('file', Buffer.from(csv, 'utf8'), 'kraken.csv')
  return res.body as { preset: string | null; duplicateExchangeSource: string | null }
}

let symbolCounter = 0
function uniqueSymbol(): string {
  symbolCounter += 1
  return `IT${process.pid % 10000}X${symbolCounter}`
}

describe('CSV-Import (Integration)', () => {
  it('Transaktions-Import: Netto-Bestände, gespeicherte Transaktionen inkl. Fee/Preis', async () => {
    const user = await registerUser('txnet')
    const csv =
      'Datum;Typ;Coin;Menge;Kurs;Gebühr\n' +
      '2024-01-01;Kauf;BTC;1;42.000,50;1,5\n' +
      '01.02.2024;Verkauf;BTC;0,4;45000;0,9\n' +
      '2024-03-01;Einzahlung;SOL;10;;\n'
    const upload = await uploadCsv(user, csv, 'TRANSACTIONS')

    const res = await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({
        mapping: {
          symbol: 'Coin',
          quantity: 'Menge',
          type: 'Typ',
          timestamp: 'Datum',
          price: 'Kurs',
          fee: 'Gebühr',
        },
      })
    expect(res.status).toBe(200)
    expect(res.body.import.status).toBe('COMPLETED')
    expect(res.body.import.importedRows).toBe(3)

    // Netto: BTC 1 − 0,4 = 0,6 · SOL +10
    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    const btc = holdings.body.holdings.find((h: { asset: { symbol: string } }) => h.asset.symbol === 'BTC')
    const sol = holdings.body.holdings.find((h: { asset: { symbol: string } }) => h.asset.symbol === 'SOL')
    expect(btc.quantity).toBe('0.6')
    expect(sol.quantity).toBe('10')

    // Transaktionen vollständig gespeichert, Fee/Preis normalisiert (deutsches Zahlformat)
    const transactions = await prisma.transaction.findMany({
      where: { sourceId: upload.import.sourceId },
      orderBy: { timestamp: 'asc' },
    })
    expect(transactions).toHaveLength(3)
    expect(transactions[0]?.type).toBe('BUY')
    expect(transactions[0]?.pricePerUnit?.toString()).toBe('42000.5')
    expect(transactions[0]?.feeAmount?.toString()).toBe('1.5')
    expect(transactions[1]?.type).toBe('SELL')
    expect(transactions[2]?.pricePerUnit).toBeNull()
    expect(transactions.every((t) => t.importId === upload.import.id)).toBe(true)
  })

  it('Import ohne einzige gültige Zeile wird als FAILED markiert', async () => {
    const user = await registerUser('allbad')
    const upload = await uploadCsv(user, 'Coin,Amount\n,1\nBTC,kaputt\n', 'BALANCES')
    const res = await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({ mapping: { symbol: 'Coin', quantity: 'Amount' } })
    expect(res.body.import.status).toBe('FAILED')
    expect(res.body.import.importedRows).toBe(0)
    expect(res.body.import.errorRows).toHaveLength(2)
  })

  it('zweite Mapping-Ausführung wird mit IMPORT_ALREADY_DONE abgelehnt', async () => {
    const user = await registerUser('twice')
    const upload = await uploadCsv(user, 'Coin,Amount\nBTC,1\n', 'BALANCES')
    const mapping = { mapping: { symbol: 'Coin', quantity: 'Amount' } }
    await request(app).post(`${API}/imports/${upload.import.id}/mapping`).set(...bearer(user)).send(mapping).expect(200)
    const second = await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send(mapping)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('IMPORT_ALREADY_DONE')
  })

  it('unbekannte Symbole werden als unmapped Assets angelegt (kein Preis)', async () => {
    const user = await registerUser('unmapped')
    const symbol = uniqueSymbol()
    const upload = await uploadCsv(user, `Coin,Amount\n${symbol},5\n`, 'BALANCES')
    await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({ mapping: { symbol: 'Coin', quantity: 'Amount' } })
      .expect(200)

    const holdings = await request(app).get(`${API}/holdings`).set(...bearer(user))
    const unknown = holdings.body.holdings.find(
      (h: { asset: { symbol: string } }) => h.asset.symbol === symbol,
    )
    expect(unknown.valueEur).toBeNull()
    expect(unknown.asset.coingeckoId).toBeNull()

    const summary = await request(app).get(`${API}/portfolio/summary`).set(...bearer(user))
    expect(summary.body.unmappedAssets.map((a: { symbol: string }) => a.symbol)).toContain(symbol)
  })

  it('Import löschen entfernt Quelle, Holdings und Transaktionen (Cascade)', async () => {
    const user = await registerUser('cascade')
    const upload = await uploadCsv(user, 'Datum;Typ;Coin;Menge\n2024-01-01;Kauf;BTC;1\n', 'TRANSACTIONS')
    await request(app)
      .post(`${API}/imports/${upload.import.id}/mapping`)
      .set(...bearer(user))
      .send({ mapping: { symbol: 'Coin', quantity: 'Menge', type: 'Typ', timestamp: 'Datum' } })
      .expect(200)

    await request(app).delete(`${API}/imports/${upload.import.id}`).set(...bearer(user)).expect(204)

    expect(await prisma.transaction.count({ where: { sourceId: upload.import.sourceId } })).toBe(0)
    expect(await prisma.holding.count({ where: { sourceId: upload.import.sourceId } })).toBe(0)
    const sources = await request(app).get(`${API}/sources`).set(...bearer(user))
    expect(sources.body.sources).toHaveLength(0)
  })

  it('Doppel-Erkennung: warnt, wenn dieselbe Börse bereits per API verbunden ist', async () => {
    const user = await registerUser('dup-detect')
    await createExchangeSource(user, 'Kraken Haupt') // provider KRAKEN

    const res = await uploadRaw(user, KRAKEN_CSV)
    expect(res.preset).toBe('KRAKEN')
    expect(res.duplicateExchangeSource).toBe('Kraken Haupt')
  })

  it('Doppel-Erkennung: keine Warnung ohne passende API-Quelle', async () => {
    const user = await registerUser('dup-none')
    const res = await uploadRaw(user, KRAKEN_CSV)
    expect(res.preset).toBe('KRAKEN')
    expect(res.duplicateExchangeSource).toBeNull()
  })
})
