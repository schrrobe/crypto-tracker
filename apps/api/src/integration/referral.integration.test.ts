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
  return res.body.user as { id: string; plan: 'FREE' | 'PRO' }
}

async function fireInvoicePaid(customer: string, invoiceId: string, billingReason = 'subscription_cycle') {
  fakeEvent = {
    type: 'invoice.paid',
    data: { object: { customer, id: invoiceId, amount_paid: 1000, currency: 'eur', billing_reason: billingReason } },
  }
  const { handleWebhookEvent } = await import('../modules/billing/billing.service')
  await handleWebhookEvent(Buffer.from('{}'), 'sig')
}

async function fireChargeRefunded(customer: string) {
  fakeEvent = { type: 'charge.refunded', data: { object: { customer, id: `ch_${customer}` } } }
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

  it('GET /referral liefert Code + Link + Reward-Felder, Code einmalig generiert', async () => {
    const user = await registerUser('ref-self', 'FREE')
    const res = await request(app).get(`${API}/referral`).set(...bearer(user))
    expect(res.status).toBe(200)
    expect(res.body.code).toMatch(/^[A-Z2-9]{8}$/)
    expect(res.body.link).toContain(`ref=${res.body.code}`)
    expect(res.body.invitedCount).toBe(0)
    expect(res.body.earnedProDays).toBe(0)
    expect(res.body.proConversions).toBe(0)
    expect(res.body.rewardDays).toBe(30)
  })

  it('Signup mit gültigem Code: Referrer verknüpft + Eingeladener bekommt 30 Pro-Tage; ungültiger Code ignoriert', async () => {
    const referrer = await registerUser('ref-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))

    const invited = await registerWithCode('ref-invited', ref.code)
    expect(invited.plan).toBe('PRO') // signup reward → effective PRO immediately
    const inv = await prisma.user.findUnique({ where: { id: invited.id } })
    expect(inv?.referredById).toBe(referrer.userId)
    expect(inv?.referralProUntil && inv.referralProUntil.getTime() > Date.now()).toBe(true)
    const signupReward = await prisma.referralReward.findUnique({ where: { idempotencyKey: `signup:${invited.id}` } })
    expect(signupReward?.kind).toBe('SIGNUP')
    expect(signupReward?.grantedDays).toBe(30)

    const orphan = await registerWithCode('ref-orphan', 'NOTACODE')
    expect(orphan.plan).toBe('FREE')
    const orphanUser = await prisma.user.findUnique({ where: { id: orphan.id } })
    expect(orphanUser?.referredById).toBeNull()
  })

  it('Erste Pro-Konversion schreibt dem Referrer 30 Pro-Tage gut – idempotent, kein Reward bei manueller Rechnung', async () => {
    const referrer = await registerUser('ref-pay-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invited = await registerWithCode('ref-pay-i', ref.code)
    const customer = `cus_${invited.id}`
    await prisma.user.update({ where: { id: invited.id }, data: { stripeCustomerId: customer } })

    await fireInvoicePaid(customer, `in_${invited.id}`) // first conversion → reward
    await fireInvoicePaid(customer, `in2_${invited.id}`) // second cycle → no extra reward
    await fireInvoicePaid(customer, `in_manual_${invited.id}`, 'manual') // manual → no reward

    const rewards = await prisma.referralReward.findMany({ where: { userId: referrer.userId, kind: 'CONVERSION' } })
    expect(rewards).toHaveLength(1)
    expect(rewards[0]!.grantedDays).toBe(30)
    expect(rewards[0]!.referredUserId).toBe(invited.id)

    const referrerUser = await prisma.user.findUnique({ where: { id: referrer.userId } })
    expect(referrerUser?.referralProUntil && referrerUser.referralProUntil.getTime() > Date.now()).toBe(true)

    const overview = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    expect(overview.body.proConversions).toBe(1)
    expect(overview.body.earnedProDays).toBe(30)
    expect(overview.body.invitedCount).toBe(1)
    expect(overview.body.invited[0].emailMasked).toMatch(/^.\*\*\*@/)
    expect(overview.body.invited[0].isPro).toBe(true) // invitee has the signup bonus
  })

  it('Refund des Eingeladenen storniert die Konversions-Belohnung (Pro-Tage bleiben, aus Metriken raus)', async () => {
    const referrer = await registerUser('ref-refund-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invited = await registerWithCode('ref-refund-i', ref.code)
    const customer = `cus_${invited.id}`
    await prisma.user.update({ where: { id: invited.id }, data: { stripeCustomerId: customer } })
    await fireInvoicePaid(customer, `in_${invited.id}`)

    await fireChargeRefunded(customer)

    const reward = await prisma.referralReward.findUnique({ where: { idempotencyKey: `conversion:${invited.id}` } })
    expect(reward?.voidedAt).not.toBeNull()

    const overview = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    expect(overview.body.proConversions).toBe(0) // voided excluded
    expect(overview.body.earnedProDays).toBe(0)
  })

  it('Admin-Rewards: ohne Admin 404, mit Admin gelistet', async () => {
    const referrer = await registerUser('ref-admin-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invited = await registerWithCode('ref-admin-i', ref.code)
    const customer = `cus_${invited.id}`
    await prisma.user.update({ where: { id: invited.id }, data: { stripeCustomerId: customer } })
    await fireInvoicePaid(customer, `in_admin_${invited.id}`)

    const nonAdmin = await request(app).get(`${API}/admin/referral/rewards`).set(...bearer(referrer))
    expect(nonAdmin.status).toBe(404)

    const admin = await registerUser('ref-admin', 'FREE')
    await makeAdmin(admin)
    const listed = await request(app).get(`${API}/admin/referral/rewards`).set(...bearer(admin))
    expect(listed.status).toBe(200)
    const entry = listed.body.rewards.find(
      (r: { kind: string; referredUserId: string | null }) => r.kind === 'CONVERSION' && r.referredUserId === invited.id,
    )
    expect(entry.grantedDays).toBe(30)
  })
})
