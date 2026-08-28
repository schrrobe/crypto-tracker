import Stripe from 'stripe'
import { Prisma, type Plan } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { recordCommissionForInvoice, reverseCommission } from '../referral/referral.service'

// Billing is only active when a Stripe secret is configured. Without a key the
// endpoints return 503 (BILLING_DISABLED); locally the plan is tested via the
// dev switch (PATCH /auth/me).
export function billingEnabled(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY)
}

// Public billing config for the client: whether checkout is available and the
// price label to show on the paywall. Lets the app hide the Upgrade CTA (and the
// "pay in browser" hint) when Stripe is not configured, instead of showing a
// button that 503s. The price label is display-only — the real amount is in Stripe.
export function billingConfig(): { enabled: boolean; priceLabel: string | null } {
  // Checkout needs both a secret AND a price id; report enabled only when checkout
  // can actually complete, so the client never shows an Upgrade CTA that 503s.
  return {
    enabled: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID),
    priceLabel: env.STRIPE_PRICE_LABEL ?? null,
  }
}

// Create the Stripe client on demand (reads env at call time → testable without
// having to set the key at module import).
function requireStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError('BILLING_DISABLED', 503, 'Bezahlung ist nicht konfiguriert')
  }
  return new Stripe(env.STRIPE_SECRET_KEY)
}

async function getOrCreateCustomer(userId: string): Promise<string> {
  const s = requireStripe()
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw AppError.unauthorized()
  if (user.stripeCustomerId) return user.stripeCustomerId
  const customer = await s.customers.create(
    { email: user.email, metadata: { userId } },
    // Stripe request idempotency prevents concurrent/retried calls from minting
    // multiple customers before either caller stores the id locally.
    { idempotencyKey: `crypto-tracker:customer:${userId}` },
  )
  const claimed = await prisma.user.updateMany({
    where: { id: userId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  })
  if (claimed.count === 1) return customer.id
  const winner = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } })
  if (winner?.stripeCustomerId) return winner.stripeCustomerId
  throw AppError.unauthorized()
}

export async function createCheckoutSession(userId: string): Promise<string> {
  const s = requireStripe()
  if (!env.STRIPE_PRICE_ID) throw new AppError('BILLING_DISABLED', 503, 'Kein Stripe-Preis konfiguriert')
  const customer = await getOrCreateCustomer(userId)
  const reservedAt = new Date()
  // Stripe requires expires_at to be at least 30 minutes in the future. Use one
  // minute of transport slack and keep the DB reservation aligned to it.
  const pendingUntil = new Date(reservedAt.getTime() + 31 * 60 * 1000)
  // Reserve the checkout slot before the external call. Until the webhook creates
  // a subscription there is otherwise no local state preventing two sessions.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${userId}`}))`
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { stripeSubscriptionId: true, stripeCheckoutPendingUntil: true },
    })
    if (!user) throw AppError.unauthorized()
    if (user.stripeSubscriptionId) {
      throw AppError.conflict('ALREADY_SUBSCRIBED', 'Es besteht bereits ein Abo')
    }
    if (user.stripeCheckoutPendingUntil && user.stripeCheckoutPendingUntil > reservedAt) {
      throw AppError.conflict('CHECKOUT_ALREADY_PENDING', 'Ein Bezahlvorgang läuft bereits')
    }
    await tx.user.update({ where: { id: userId }, data: { stripeCheckoutPendingUntil: pendingUntil } })
  })
  // The session id is echoed back on the success URL so the client can reconcile
  // the plan immediately, without waiting for the (possibly delayed) webhook.
  const successBase = env.STRIPE_SUCCESS_URL ?? `${env.APP_PUBLIC_URL}/tabs/settings`
  const sep = successBase.includes('?') ? '&' : '?'
  const session = await s.checkout.sessions.create(
    {
      mode: 'subscription',
      customer,
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: userId,
      success_url: `${successBase}${sep}upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: env.STRIPE_CANCEL_URL ?? `${env.APP_PUBLIC_URL}/tabs/settings`,
      expires_at: Math.floor(pendingUntil.getTime() / 1000),
    },
    { idempotencyKey: `crypto-tracker:checkout:${userId}:${reservedAt.toISOString()}` },
  )
  // Do not clear the reservation on an ambiguous network failure: Stripe may have
  // created the session even though the response never arrived. It expires with
  // the matching Stripe session, after which a retry is safe.
  if (!session.url) throw new AppError('BILLING_ERROR', 502, 'Stripe lieferte keine Checkout-URL')
  return session.url
}

export async function createPortalSession(userId: string): Promise<string> {
  const s = requireStripe()
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user?.stripeCustomerId) throw AppError.badRequest('NO_SUBSCRIPTION', 'Kein Abo vorhanden')
  const portal = await s.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: env.STRIPE_SUCCESS_URL ?? `${env.APP_PUBLIC_URL}/tabs/settings`,
  })
  return portal.url
}

// In newer Stripe API versions (basil), current_period_end moved from the
// subscription object onto the individual items; check both places (fallback).
function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined
  const top = (sub as unknown as { current_period_end?: number }).current_period_end
  return item?.current_period_end ?? top ?? null
}

// Cancel the subscription at Stripe (e.g. on account deletion). No-op without configured billing.
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const s = requireStripe()
  await s.subscriptions.cancel(subscriptionId)
}

async function applyPlanByCustomer(
  customerId: string,
  plan: Plan,
  subscriptionId: string | null,
  periodEndSec: number | null,
  eventAtSec: number,
  fallbackUserId?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { stripeCustomerId: customerId } })
    // A signed Checkout event carries our server-set client_reference_id. Heal a
    // stale/missing customer link so later subscription events remain routable.
    if (!user && fallbackUserId) {
      user = await tx.user.findUnique({ where: { id: fallbackUserId } })
      if (user) {
        await tx.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } })
      }
    }
    if (!user) {
      console.warn(`[billing] webhook for unknown Stripe customer ${customerId} — no user matched`)
      return
    }

    // Serialize plan-affecting events per user. The old check and update were two
    // independent statements, allowing an older concurrent event to commit last.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
    const eventAt = new Date(eventAtSec * 1000)
    if (current.lastStripeEventAt) {
      if (eventAt < current.lastStripeEventAt) return
      // Stripe timestamps have one-second precision. If active/canceled events
      // share a timestamp, prefer the least-privileged state so delivery order
      // cannot accidentally re-grant Pro after cancellation.
      if (eventAt.getTime() === current.lastStripeEventAt.getTime() && current.plan === 'FREE' && plan === 'PRO') {
        return
      }
    }
    await tx.user.update({
      where: { id: user.id },
      data: {
        plan,
        stripeSubscriptionId: subscriptionId,
        stripeCheckoutPendingUntil: null,
        // Only set planUntil when a period end is present — do NOT reset it to null:
        // checkout.session.completed may provide none, and must not erase a valid date.
        ...(periodEndSec ? { planUntil: new Date(periodEndSec * 1000) } : {}),
        lastStripeEventAt: eventAt,
      },
    })
  })
}

// Reconcile the plan from a completed Checkout session on the success-return,
// closing the "paid but webhook delayed/dropped" gap. Authoritative on-demand
// read of Stripe state; ownership is verified against the caller.
export async function reconcileCheckoutSession(
  userId: string,
  sessionId: string,
): Promise<{ plan: Plan }> {
  const s = requireStripe()
  let session: Stripe.Checkout.Session
  try {
    session = await s.checkout.sessions.retrieve(sessionId)
  } catch {
    throw AppError.notFound('Checkout-Sitzung nicht gefunden')
  }
  // 404 (not 403) for a session that isn't this user's — don't reveal it exists.
  const ownsByRef = session.client_reference_id === userId
  let ownsByCustomer = false
  if (!ownsByRef && session.customer) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } })
    ownsByCustomer = Boolean(me?.stripeCustomerId) && me?.stripeCustomerId === String(session.customer)
  }
  if (!ownsByRef && !ownsByCustomer) throw AppError.notFound('Checkout-Sitzung nicht gefunden')

  if (session.payment_status === 'paid' && session.customer && session.subscription) {
    const sub = await s.subscriptions.retrieve(String(session.subscription))
    // Derive the plan from the CURRENT subscription status, not just "paid": a paid
    // session can reference an already-canceled sub. Forcing PRO (and stamping
    // lastStripeEventAt=now) would also suppress the real downgrade event.
    const active = sub.status === 'active' || sub.status === 'trialing'
    await applyPlanByCustomer(
      String(session.customer),
      active ? 'PRO' : 'FREE',
      active ? sub.id : null,
      subscriptionPeriodEnd(sub),
      Math.floor(Date.now() / 1000),
      userId,
    )
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
  return { plan: user?.plan ?? 'FREE' }
}

// Webhook: verify the signature, then set the plan based on the subscription.
export async function handleWebhookEvent(rawBody: Buffer, signature: string | undefined): Promise<void> {
  const s = requireStripe()
  if (!env.STRIPE_WEBHOOK_SECRET) throw new AppError('BILLING_DISABLED', 503, 'Kein Webhook-Secret')
  if (!signature) throw AppError.badRequest('WEBHOOK_SIGNATURE', 'Signatur fehlt')

  let event: Stripe.Event
  try {
    event = s.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch {
    throw AppError.badRequest('WEBHOOK_SIGNATURE', 'Ungültige Stripe-Signatur')
  }

  // Idempotency: Stripe delivers at-least-once and retries for up to 3 days.
  // Skip an event we have already fully processed.
  if (await prisma.processedStripeEvent.findUnique({ where: { id: event.id } })) return

  await dispatchStripeEvent(s, event)

  // Mark processed only AFTER the handler succeeded, so a transient failure
  // (subscriptions.retrieve / DB error) is retried by Stripe instead of being
  // dropped permanently. Concurrent duplicate deliveries are guarded by the unique
  // id (P2002 → already recorded) and by each handler's own idempotency.
  await prisma.processedStripeEvent.create({ data: { id: event.id, type: event.type } }).catch((e) => {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
  })
}

// Dispatch a verified Stripe event to its handler. Throwing here prevents the
// event from being marked processed, so Stripe retries the delivery.
async function dispatchStripeEvent(s: Stripe, event: Stripe.Event): Promise<void> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const refUserId = session.client_reference_id ?? undefined
    if (session.customer && session.subscription) {
      // Load the subscription so planUntil is set immediately on upgrade
      // (the session itself carries no period end).
      const sub = await s.subscriptions.retrieve(String(session.subscription))
      const active = sub.status === 'active' || sub.status === 'trialing'
      await applyPlanByCustomer(
        String(session.customer),
        active ? 'PRO' : 'FREE',
        active ? sub.id : null,
        subscriptionPeriodEnd(sub),
        event.created,
        refUserId,
      )
    }
    return
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const active = sub.status === 'active' || sub.status === 'trialing'
    await applyPlanByCustomer(
      String(sub.customer),
      active ? 'PRO' : 'FREE',
      active ? sub.id : null,
      subscriptionPeriodEnd(sub),
      event.created,
    )
    return
  }
  // Dunning signal. We deliberately do NOT downgrade here: Stripe retries the
  // failed invoice over several days, then fires subscription.updated/deleted
  // (handled above) which performs the actual downgrade. Record the failure for
  // support visibility and keep Pro until the subscription truly ends.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice
    if (!invoice.customer) return
    const res = await prisma.user.updateMany({
      where: { stripeCustomerId: String(invoice.customer) },
      data: { paymentFailedAt: new Date(event.created * 1000) },
    })
    if (res.count === 0) {
      console.warn(`[billing] invoice.payment_failed for unknown Stripe customer ${invoice.customer}`)
    }
    return
  }
  // Recurring referral commission: each paid invoice of an invited user credits
  // their referrer 20% of NET revenue (ex-VAT, ex-discount), idempotent per invoice.
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice
    if (!invoice.customer || !invoice.id || invoice.amount_paid <= 0) return
    const payer = await prisma.user.findUnique({
      where: { stripeCustomerId: String(invoice.customer) },
      select: { id: true, referredById: true, paymentFailedAt: true },
    })
    // Any successful charge clears a prior dunning marker (independent of the
    // referral-only billing_reason filter below).
    if (payer?.paymentFailedAt) {
      await prisma.user.update({ where: { id: payer.id }, data: { paymentFailedAt: null } })
    }
    // Only reward genuine subscription charges — skip prorations, manual one-off
    // invoices, etc. (Stripe emits invoice.paid for those too).
    if (invoice.billing_reason !== 'subscription_create' && invoice.billing_reason !== 'subscription_cycle') return
    if (!payer?.referredById) return
    // Net basis: total ex-tax (after discounts, before VAT). On a paid/finalized
    // invoice it is always present. Fall back to amount_paid (post-discount, what
    // the customer actually paid) — NOT subtotal, which ignores invoice-level
    // discounts and would overstate the commission on a discounted invoice.
    const inv = invoice as Stripe.Invoice & { total_excluding_tax?: number | null }
    const netAmountCents = inv.total_excluding_tax ?? invoice.amount_paid
    await recordCommissionForInvoice({
      referredUserId: payer.id,
      referrerId: payer.referredById,
      stripeInvoiceId: invoice.id,
      netAmountCents,
      currency: invoice.currency,
      stripeChargeId: stripeIdOf((invoice as { charge?: unknown }).charge),
      stripeSubscriptionId: stripeIdOf((invoice as { subscription?: unknown }).subscription),
    })
    return
  }
  // Clawback: a refunded charge reverses the matching commission (whole, conservatively).
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge
    await reverseCommission({ stripeChargeId: charge.id, reason: 'charge.refunded' })
    return
  }
  // Clawback: a disputed/charged-back payment reverses the commission.
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute
    await reverseCommission({ stripeChargeId: stripeIdOf(dispute.charge), reason: 'charge.dispute.created' })
    return
  }
  // Clawback: a voided invoice reverses the commission booked for it.
  if (event.type === 'invoice.voided') {
    const invoice = event.data.object as Stripe.Invoice
    if (invoice.id) await reverseCommission({ stripeInvoiceId: invoice.id, reason: 'invoice.voided' })
    return
  }
}

// Stripe fields are id-or-expanded-object-or-null; normalize to the id string.
function stripeIdOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return null
}
