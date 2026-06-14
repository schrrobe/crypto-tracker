import request from 'supertest'
import { createApp } from '../app'

export const app = createApp()
export const API = '/api/v1'

let counter = 0

export function uniqueEmail(prefix: string): string {
  counter += 1
  return `${prefix}-${process.pid}-${Date.now()}-${counter}@integration.test`
}

export interface TestUser {
  userId: string
  email: string
  token: string
  refreshToken: string
}

export const PASSWORD = 'superSicheresPasswort1'

// Default-Plan PRO: die meisten Tests prüfen Funktionalität, nicht das Gating,
// und sollen nicht an Free-Limits (Quellen/Portfolios/Steuerreport) stoßen.
// Gating-Tests fordern explizit 'FREE' an.
export async function registerUser(prefix = 'user', plan: 'FREE' | 'PRO' = 'PRO'): Promise<TestUser> {
  // X-Client: native → Refresh-Token kommt im Body (statt httpOnly-Cookie),
  // damit die Integrationstests ihn direkt verwenden können
  const res = await request(app)
    .post(`${API}/auth/register`)
    .set('X-Client', 'native')
    .send({ email: uniqueEmail(prefix), password: PASSWORD })
  if (res.status !== 201) throw new Error(`register fehlgeschlagen: ${JSON.stringify(res.body)}`)
  const user: TestUser = {
    userId: res.body.user.id,
    email: res.body.user.email,
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  }
  if (plan === 'PRO') await setPlan(user, 'PRO')
  return user
}

export function bearer(user: TestUser): [string, string] {
  return ['Authorization', `Bearer ${user.token}`]
}

// Dev-Schalter (nur APP_ENV=local): Plan zum Testen des Gatings setzen
export async function setPlan(user: TestUser, plan: 'FREE' | 'PRO') {
  await request(app).patch(`${API}/auth/me`).set(...bearer(user)).send({ plan }).expect(200)
}

// Fake-Provider-Quelle (FAKE_PROVIDERS=true): Sync liefert 0.1 BTC + 2 ETH
export async function createExchangeSource(
  user: TestUser,
  label: string,
  apiKey = 'valid-key-1234',
  provider = 'KRAKEN',
) {
  const res = await request(app)
    .post(`${API}/sources`)
    .set(...bearer(user))
    .send({ type: 'EXCHANGE', provider, label, apiKey, apiSecret: 'valid-secret' })
  if (res.status !== 201) throw new Error(`createSource fehlgeschlagen: ${JSON.stringify(res.body)}`)
  return res.body.source as { id: string }
}

export async function createManualSource(user: TestUser, label: string) {
  const res = await request(app)
    .post(`${API}/sources`)
    .set(...bearer(user))
    .send({ type: 'MANUAL', label })
  if (res.status !== 201) throw new Error(`createManualSource fehlgeschlagen: ${JSON.stringify(res.body)}`)
  return res.body.source as { id: string }
}

export async function uploadCsv(
  user: TestUser,
  csv: string,
  kind: 'BALANCES' | 'TRANSACTIONS',
  label = 'Integration CSV',
) {
  const res = await request(app)
    .post(`${API}/imports`)
    .set(...bearer(user))
    .field('kind', kind)
    .field('label', label)
    .attach('file', Buffer.from(csv, 'utf8'), 'integration.csv')
  if (res.status !== 201) throw new Error(`upload fehlgeschlagen: ${JSON.stringify(res.body)}`)
  return res.body as { import: { id: string; sourceId: string } }
}

export async function createPortfolio(user: TestUser, label: string) {
  const res = await request(app)
    .post(`${API}/portfolios`)
    .set(...bearer(user))
    .send({ label })
  if (res.status !== 201) throw new Error(`createPortfolio fehlgeschlagen: ${JSON.stringify(res.body)}`)
  return res.body.portfolio as { id: string; label: string; isDefault: boolean }
}
