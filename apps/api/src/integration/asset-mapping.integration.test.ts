import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { API, app, bearer, makeAdmin, registerUser } from './helpers'

let counter = 0
function uniqueSymbol(): string {
  counter += 1
  return `MAP${process.pid % 10000}N${counter}`
}

// In FAKE_PRICES mode fetchCoinSymbol("<sym>-coin") echoes "<SYM>", so a coingecko
// id of "<symbol-lowercased>-coin" matches the asset symbol.
const idFor = (symbol: string) => `${symbol.toLowerCase()}-coin`

async function createUnmappedAsset(symbol: string) {
  return prisma.asset.create({ data: { symbol, name: `${symbol} Coin`, coingeckoId: null } })
}

describe('Asset-Mapping (Integration)', () => {
  it('lehnt Mapping ab, wenn das CoinGecko-Symbol nicht zum Asset passt', async () => {
    const user = await registerUser('map-mismatch', 'FREE')
    const symbol = uniqueSymbol()
    const asset = await createUnmappedAsset(symbol)

    const res = await request(app)
      .post(`${API}/assets/${asset.id}/mapping`)
      .set(...bearer(user))
      .send({ coingeckoId: idFor(`zz${symbol}`) }) // unused id, symbol ZZ… ≠ asset symbol
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('COINGECKO_SYMBOL_MISMATCH')

    const after = await prisma.asset.findUnique({ where: { id: asset.id } })
    expect(after?.coingeckoId).toBeNull() // not poisoned
  })

  it('akzeptiert Mapping bei passendem Symbol', async () => {
    const user = await registerUser('map-match', 'FREE')
    const symbol = uniqueSymbol()
    const asset = await createUnmappedAsset(symbol)

    const res = await request(app)
      .post(`${API}/assets/${asset.id}/mapping`)
      .set(...bearer(user))
      .send({ coingeckoId: idFor(symbol) })
    expect(res.status).toBe(200)
    expect(res.body.asset.coingeckoId).toBe(idFor(symbol))
  })

  it('verhindert erneutes Mapping eines bereits gemappten Assets', async () => {
    const user = await registerUser('map-already', 'FREE')
    const symbol = uniqueSymbol()
    const asset = await prisma.asset.create({
      data: { symbol, name: `${symbol} Coin`, coingeckoId: idFor(symbol) },
    })
    const res = await request(app)
      .post(`${API}/assets/${asset.id}/mapping`)
      .set(...bearer(user))
      .send({ coingeckoId: idFor(symbol) })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ASSET_ALREADY_MAPPED')
  })

  it('Admin-Remap: Nicht-Admin → 404, Admin korrigiert ein falsches Mapping', async () => {
    const symbol = uniqueSymbol()
    // Seed a legacy BAD mapping directly (wrong coin, right symbol-asset).
    const asset = await prisma.asset.create({
      data: { symbol, name: `${symbol} Coin`, coingeckoId: `wrong-${symbol.toLowerCase()}-x` },
    })

    const plainUser = await registerUser('remap-deny', 'FREE')
    const denied = await request(app)
      .put(`${API}/admin/assets/${asset.id}/mapping`)
      .set(...bearer(plainUser))
      .send({ coingeckoId: idFor(symbol) })
    expect(denied.status).toBe(404) // requireAdmin hides the route

    const admin = await registerUser('remap-admin', 'FREE')
    await makeAdmin(admin)
    const fixed = await request(app)
      .put(`${API}/admin/assets/${asset.id}/mapping`)
      .set(...bearer(admin))
      .send({ coingeckoId: idFor(symbol) })
    expect(fixed.status).toBe(200)
    expect(fixed.body.asset.coingeckoId).toBe(idFor(symbol))
  })

  it('Admin-Remap lehnt Symbol-Mismatch ab', async () => {
    const symbol = uniqueSymbol()
    const asset = await createUnmappedAsset(symbol)
    const admin = await registerUser('remap-mismatch', 'FREE')
    await makeAdmin(admin)
    const res = await request(app)
      .put(`${API}/admin/assets/${asset.id}/mapping`)
      .set(...bearer(admin))
      .send({ coingeckoId: idFor(`zz${symbol}`) })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('COINGECKO_SYMBOL_MISMATCH')
  })

  it('Admin-Unmap setzt coingeckoId zurück, danach ist Remap möglich', async () => {
    const symbol = uniqueSymbol()
    const asset = await prisma.asset.create({
      data: { symbol, name: `${symbol} Coin`, coingeckoId: idFor(symbol) },
    })
    const admin = await registerUser('unmap-admin', 'FREE')
    await makeAdmin(admin)

    const cleared = await request(app)
      .delete(`${API}/admin/assets/${asset.id}/mapping`)
      .set(...bearer(admin))
    expect(cleared.status).toBe(200)
    expect(cleared.body.asset.coingeckoId).toBeNull()

    // A regular user can now map it again.
    const user = await registerUser('unmap-user', 'FREE')
    const remap = await request(app)
      .post(`${API}/assets/${asset.id}/mapping`)
      .set(...bearer(user))
      .send({ coingeckoId: idFor(symbol) })
    expect(remap.status).toBe(200)
  })
})
