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

// Distinct event id + created per delivery so the webhook idempotency guard
// (ProcessedStripeEvent on event.id) never fires here — duplicate-invoice
// idempotency is exercised at the invoice level (stripeInvoiceId unique), which
// is the contract these tests verify.
// Run-unique prefix: ProcessedStripeEvent (event.id) persists across runs in the
// shared test DB, so a fixed counter would collide with a prior run's rows and get
// deduped. Date.now() makes every run's ids fresh.
const EVENT_RUN = Date.now()
let eventSeq = 0
async function fireEvent(event: Record<string, unknown>) {
  eventSeq += 1
  // Spread event FIRST so the generated unique id/created always win — a caller's
  // fixed id must never collapse two deliveries into one webhook-dedup hit.
  fakeEvent = { ...event, id: `evt_ref_${EVENT_RUN}_${eventSeq}`, created: 1000 + eventSeq }
  const { handleWebhookEvent } = await import('../modules/billing/billing.service')
  await handleWebhookEvent(Buffer.from('{}'), 'sig')
}

async function fireInvoicePaid(
  customer: string,
  invoiceId: string,
  amountCents: number,
  billingReason = 'subscription_cycle',
  chargeId?: string,
) {
  await fireEvent({
    type: 'invoice.paid',
    data: {
      object: {
        customer,
        id: invoiceId,
        amount_paid: amountCents,
        currency: 'eur',
        billing_reason: billingReason,
        charge: chargeId ?? null,
      },
    },
  })
}

async function fireChargeRefunded(chargeId: string) {
  await fireEvent({ type: 'charge.refunded', data: { object: { id: chargeId } } })
}

// Save valid bank details (required before a payout can be settled).
async function setBank(user: Awaited<ReturnType<typeof registerUser>>) {
  await request(app)
    .put(`${API}/referral/bank`)
    .set(...bearer(user))
    .send({ iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', holder: 'Test Holder' })
}

// Make all of a referrer's commissions immediately payable (simulate clearing elapsed).
async function makePayable(referrerId: string) {
  await prisma.referralCommission.updateMany({
    where: { referrerId },
    data: { payableAt: new Date(Date.now() - 1000) },
  })
}

describe('Referral (Integration)', () => {
  const orig = {
    key: env.STRIPE_SECRET_KEY,
    wh: env.STRIPE_WEBHOOK_SECRET,
    clearing: env.REFERRAL_CLEARING_DAYS,
    min: env.REFERRAL_PAYOUT_MIN_CENTS,
  }
  beforeEach(() => {
    env.STRIPE_SECRET_KEY = 'sk_test_x'
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    // Default: immediate payability + no threshold; individual tests override.
    env.REFERRAL_CLEARING_DAYS = 0
    env.REFERRAL_PAYOUT_MIN_CENTS = 0
  })
  afterEach(() => {
    env.STRIPE_SECRET_KEY = orig.key
    env.STRIPE_WEBHOOK_SECRET = orig.wh
    env.REFERRAL_CLEARING_DAYS = orig.clearing
    env.REFERRAL_PAYOUT_MIN_CENTS = orig.min
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
    await setBank(referrer)

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

  it('Clearing-Periode: Kommission ist erst pending, nicht auszahlbar', async () => {
    env.REFERRAL_CLEARING_DAYS = 30
    const referrer = await registerUser('ref-clear-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-clear-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })
    await fireInvoicePaid(customer, `in_clear_${invitedId}`, 5000)

    const overview = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const eur = overview.body.earnings.find((e: { currency: string }) => e.currency === 'eur')
    expect(eur.pendingCents).toBe(1000)
    expect(eur.owedCents).toBe(0)

    // Admin sees nothing payable yet.
    const adminU = await registerUser('ref-clear-admin', 'FREE')
    await makeAdmin(adminU)
    const listed = await request(app).get(`${API}/admin/referral/payouts`).set(...bearer(adminU))
    expect(listed.body.payouts.find((p: { referrerId: string }) => p.referrerId === referrer.userId)).toBeUndefined()

    // Settle before clearing → 404 (nothing payable).
    const early = await request(app)
      .post(`${API}/admin/referral/payouts/${referrer.userId}/settle`)
      .set(...bearer(adminU))
      .send({ currency: 'eur' })
    expect(early.status).toBe(404)
  })

  it('Auszahlungsschwelle: Settle unter Mindestbetrag wird abgelehnt', async () => {
    env.REFERRAL_PAYOUT_MIN_CENTS = 5000
    const referrer = await registerUser('ref-thr-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-thr-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })
    await fireInvoicePaid(customer, `in_thr_${invitedId}`, 1000) // 200 commission < 5000 threshold
    await makePayable(referrer.userId)

    const adminU = await registerUser('ref-thr-admin', 'FREE')
    await makeAdmin(adminU)
    const res = await request(app)
      .post(`${API}/admin/referral/payouts/${referrer.userId}/settle`)
      .set(...bearer(adminU))
      .send({ currency: 'eur' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BELOW_THRESHOLD')
  })

  it('Refund: charge.refunded storniert die Kommission (owed → 0)', async () => {
    const referrer = await registerUser('ref-refund-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-refund-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })
    const charge = `ch_${invitedId}`
    await fireInvoicePaid(customer, `in_refund_${invitedId}`, 5000, 'subscription_cycle', charge)

    let overview = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    expect(overview.body.earnings.find((e: { currency: string }) => e.currency === 'eur').owedCents).toBe(1000)

    await fireChargeRefunded(charge)
    await fireChargeRefunded(charge) // idempotent

    overview = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const eur = overview.body.earnings.find((e: { currency: string }) => e.currency === 'eur')
    expect(eur).toBeUndefined() // reversed commissions excluded entirely
    const reversed = await prisma.referralCommission.findFirst({ where: { referrerId: referrer.userId } })
    expect(reversed?.status).toBe('REVERSED')
  })

  it('Settle-Race: parallele Settles zahlen NICHT doppelt aus', async () => {
    const referrer = await registerUser('ref-race-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-race-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })
    await fireInvoicePaid(customer, `in_race_${invitedId}`, 5000) // 1000 commission
    await makePayable(referrer.userId)
    await setBank(referrer)

    const { settlePayout } = await import('../modules/referral/referral.service')
    const results = await Promise.allSettled([
      settlePayout(referrer.userId, 'eur'),
      settlePayout(referrer.userId, 'eur'),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    // At most one settle may succeed; total paid must equal the single commission.
    expect(ok.length).toBeLessThanOrEqual(1)
    const payouts = await prisma.payout.findMany({ where: { referrerId: referrer.userId } })
    const paidCommissions = await prisma.referralCommission.count({
      where: { referrerId: referrer.userId, payoutId: { not: null } },
    })
    expect(paidCommissions).toBe(1)
    // No payout may exist without exactly its commissions backing it.
    const backed = await prisma.referralCommission.count({
      where: { payoutId: { in: payouts.filter((p) => p.status !== 'CANCELLED').map((p) => p.id) } },
    })
    expect(backed).toBe(1)
  })

  it('Refund nach Auszahlung: storniert + meldet alreadyPaid, Payout-Link bleibt als Schuld', async () => {
    const referrer = await registerUser('ref-rap-r', 'FREE')
    const { body: ref } = await request(app).get(`${API}/referral`).set(...bearer(referrer))
    const invitedId = await registerWithCode('ref-rap-i', ref.code)
    const customer = `cus_${invitedId}`
    await prisma.user.update({ where: { id: invitedId }, data: { stripeCustomerId: customer } })
    const charge = `ch_rap_${invitedId}`
    await fireInvoicePaid(customer, `in_rap_${invitedId}`, 5000, 'subscription_cycle', charge)
    await makePayable(referrer.userId)
    await setBank(referrer)

    const { settlePayout, reverseCommission } = await import('../modules/referral/referral.service')
    const payout = await settlePayout(referrer.userId, 'eur')

    // Refund AFTER the payout was sent → must report alreadyPaid so the admin can reclaim
    // (the code also emits a loud REVERSAL_AFTER_PAYOUT console.error alert).
    const result = await reverseCommission({ stripeChargeId: charge, reason: 'charge.refunded' })
    expect(result).toEqual({ reversed: true, alreadyPaid: true })

    // Durable, queryable debt marker: reversed but still linked to the sent payout.
    const c = await prisma.referralCommission.findFirst({ where: { referrerId: referrer.userId } })
    expect(c?.status).toBe('REVERSED')
    expect(c?.payoutId).toBe(payout.id)

    // And the webhook path is idempotent on a second refund delivery.
    const again = await reverseCommission({ stripeChargeId: charge, reason: 'charge.refunded' })
    expect(again.reversed).toBe(false)
  })
})
