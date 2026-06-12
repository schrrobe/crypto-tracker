import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, registerUser, type TestUser } from './helpers'

// FAKE_PROVIDERS: Solana-Wallet liefert 12 SOL + 2 deterministische Rewards
// (fake-sol-reward:1/2) — Sync ist über externalRef idempotent

let addrCounter = 0

// Eindeutige Adresse je Test: externalRef ist global unique und die Test-DB
// wird nicht zwischen Läufen geleert — gleiche Adresse = stille Dedupe-Kollision
function uniqueAddress(): string {
  addrCounter += 1
  return `So1Wallet${process.pid}x${Date.now()}x${addrCounter}`
}

async function createSolanaSource(user: TestUser) {
  const address = uniqueAddress()
  const res = await request(app)
    .post(`${API}/sources`)
    .set(...bearer(user))
    .send({ type: 'WALLET', provider: 'SOLANA', label: 'Sol Wallet', address })
  expect(res.status).toBe(201)
  return { id: (res.body.source as { id: string }).id, address }
}

describe('On-Chain-Staking-Rewards (Integration)', () => {
  it('Sync erzeugt Reward-Transaktionen, zweiter Sync dupliziert nicht', async () => {
    const user = await registerUser('rewards')
    const source = await createSolanaSource(user)

    const sync1 = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(sync1.body.run.status).toBe('SUCCESS')

    const txs = await prisma.transaction.findMany({ where: { sourceId: source.id } })
    expect(txs).toHaveLength(2)
    expect(txs.every((t) => t.type === 'STAKING_REWARD')).toBe(true)
    expect(txs.map((t) => t.externalRef).sort()).toEqual([
      `fake-sol-reward:1:${source.address}`,
      `fake-sol-reward:2:${source.address}`,
    ])

    // Idempotenz: erneuter Sync erzeugt nichts Neues
    const sync2 = await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))
    expect(sync2.body.run.status).toBe('SUCCESS')
    const after = await prisma.transaction.count({ where: { sourceId: source.id } })
    expect(after).toBe(2)

    // Holdings bleiben Snapshot-basiert (12 SOL vom Fake-Provider, keine Reward-Addition)
    const holdings = await prisma.holding.findMany({ where: { sourceId: source.id } })
    expect(holdings).toHaveLength(1)
    expect(holdings[0]?.quantity.toString()).toBe('12')

    // Rewards erscheinen in der Transaktionsliste, nicht editierbar
    const list = await request(app).get(`${API}/transactions?sourceId=${source.id}`).set(...bearer(user))
    expect(list.body.transactions).toHaveLength(2)
    expect(list.body.transactions[0].editable).toBe(false)
  })

  it('DE-Report: Reward-Zufluss als Staking-Einkommen + WALLET_REWARDS_ONLY-Hinweis', async () => {
    const user = await registerUser('rewards-tax')
    const source = await createSolanaSource(user)
    await request(app).post(`${API}/sources/${source.id}/sync`).set(...bearer(user))

    // Fake-Rewards: 0.05 + 0.07 SOL im März 2024, Kurs via Fake-Backfill
    const report = await request(app)
      .get(`${API}/tax/report?year=2024&country=DE`)
      .set(...bearer(user))
    expect(report.status).toBe(200)
    expect(Number(report.body.totals.stakingIncomeEur)).toBeGreaterThan(0)

    const codes = report.body.warnings.map((w: { code: string }) => w.code)
    expect(codes).toContain('WALLET_REWARDS_ONLY')
    // Quelle hat Transaktionen → nicht mehr in uncoveredSources
    const uncoveredIds = report.body.uncoveredSources.map((s: { id: string }) => s.id)
    expect(uncoveredIds).not.toContain(source.id)
  })
})
