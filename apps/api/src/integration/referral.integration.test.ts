import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { API, app, bearer, makeAdmin, PASSWORD, registerUser, uniqueEmail } from './helpers'

// Stripe SDK mock: only constructEvent is used by the webhook path.
let fakeEvent: unknown
vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: () => fakeEvent }
    subscriptions = { retrieve: async (id: string) => ({ id, status: 'active' }) }
  },
}))

async function registerWithCode(prefix: string, referralCode?: string) {
  const res = await request(app)
    .post(`${API}/auth/register`)
    .set('X-Client', 'native')
    .send({ email: uniqueEmail(prefix), password: PASSWORD, referralCode })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function fireInvoicePaid(
  customer: string,
  invoiceId: string,
  amountCents: number,
  billingReason = 'subscription_cycle',
) {
  fakeEvent = {
    type: 'invoice.paid',
    data: { object: { customer, id: invoiceId, amount_paid: amountCents, currency: 'eur', billing_reason: billingReason } },
  }
  const { handleWebhookEvent } = await import('../modules/billing/billing.service')
  await handleWebhookEvent(Buffer.from('{}'), 'sig')
}

describe('Referral (Integration)', () => {
  const orig = { key: env.STRIPE_SECRET_KEY, wh: env.STRIPE_WEBHOOK_SECRET }
  beforeEach(() => {
    env.STRIPE_SECRET_KEY = 'sk_test_x'
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  })
  afterEach(() => {
    env.STRIPE_SECRET_KEY = orig.key
    env.STRIPE_WEBHOOK_SECRET = orig.wh
  })

  it('GET /referral liefert einen Code + Link und generiert ihn einmalig', async () => {
    const user = await registerUser('ref-self', 'FREE')
    const res = await request(app).get(`${API}/referral`).set(...bearer(user))
    expect(res.status).toBe(200)
    expect(res.body.code).toMatch(/^[A-Z2-9]{8}$/)
    expect(res.body.link).toContain(`ref=${res.body.code}`)
    expect(res.body.invitedCount).toBe(0)
  })

  it('Registrierung mit gültigem Code verknüpft den Referrer; ungültiger Code wird ignoriert', async () => {
    const referrer = await registerUser('ref-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))

    const invitedId = await registerWithCode('ref-invited', ref.code)
    const invited = await prisma.user.findUnique({ where: { id: invitedId } })
    expect(invited?.referredById).toBe(referrer.userId)

    const orphanId = await registerWithCode('ref-orphan', 'NOTACODE')
    const orphan = await prisma.user.findUnique({ where: { id: orphanId } })
    expect(orphan?.referredById).toBeNull()
  })

  it('invoice.paid schreibt 20% Kommission gut – idempotent pro Invoice', async () => {
    const referrer = await registerUser('ref-pay-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-pay-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })

    const invoiceId = `in_${invitedId}`
    await fireInvoicePaid(customer, invoiceId, 1000) // 10.00 € → 2.00 € commission
    await fireInvoicePaid(customer, invoiceId, 1000) // duplicate → ignored
    // Non-renewal invoice (e.g. manual/proration) must NOT credit a commission.
    await fireInvoicePaid(customer, `in_manual_${invitedId}`, 5000, 'manual')

    const commissions = await prisma.referralCommission.findMany({ where: { referrerId: referrer.userId } })
    expect(commissions).toHaveLength(1)
    expect(commissions[0]!.amountCents).toBe(200)

    const overview = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const eur = overview.body.earnings.find((e: { currency: string }) => e.currency === 'eur')
    expect(eur.owedCents).toBe(200)
    expect(overview.body.invitedCount).toBe(1)
    expect(overview.body.invited[0].emailMasked).toMatch(/^.\*\*\*@/)
  })

  it('Bankdaten: PUT speichert, GET liefert nur Preview (nie volle IBAN)', async () => {
    const user = await registerUser('ref-bank', 'FREE')
    const put = await request(app)
      .put(`${API}/referral/bank`)
      .set(...bearer(user))
      .send({ iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', holder: 'Max Mustermann' })
    expect(put.status).toBe(200)
    expect(put.body.ibanPreview).toBe('…3000')

    const get = await request(app).get(`${API}/referral/bank`).set(...bearer(user))
    expect(get.body.ibanPreview).toBe('…3000')
    expect(JSON.stringify(get.body)).not.toContain('0532013000')

    const bad = await request(app)
      .put(`${API}/referral/bank`)
      .set(...bearer(user))
      .send({ iban: 'not-an-iban', bic: 'COBADEFFXXX', holder: 'X' })
    expect(bad.status).toBe(400)
  })

  it('Admin-Payout: ohne Admin 404, mit Admin listen + settlen', async () => {
    const referrer = await registerUser('ref-admin-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-admin-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })
    await fireInvoicePaid(customer, `in_admin_${invitedId}`, 5000) // 1000 cents commission

    const nonAdmin = await request(app).get(`${API}/admin/referral/payouts`).set(...bearer(referrer))
    expect(nonAdmin.status).toBe(404)

    const admin = await registerUser('ref-admin', 'FREE')
    await makeAdmin(admin)

    const listed = await request(app).get(`${API}/admin/referral/payouts`).set(...bearer(admin))
    expect(listed.status).toBe(200)
    const entry = listed.body.payouts.find((p: { referrerId: string }) => p.referrerId === referrer.userId)
    expect(entry.owedCents).toBe(1000)

    const settled = await request(app)
      .post(`${API}/admin/referral/payouts/${referrer.userId}/settle`)
      .set(...bearer(admin))
      .send({ currency: 'eur' })
    expect(settled.status).toBe(200)
    expect(settled.body.amountCents).toBe(1000)

    const after = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const eurAfter = after.body.earnings.find((e: { currency: string }) => e.currency === 'eur')
    expect(eurAfter.owedCents).toBe(0)
    expect(eurAfter.paidCents).toBe(1000)
  })
})
