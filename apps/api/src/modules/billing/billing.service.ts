import Stripe from 'stripe'
import { Prisma, type Plan } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { recordCommissionForInvoice } from '../referral/referral.service'

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
  const customer = await s.customers.create({ email: user.email, metadata: { userId } })
  await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } })
  return customer.id
}

export async function createCheckoutSession(userId: string): Promise<string> {
  const s = requireStripe()
  if (!env.STRIPE_PRICE_ID) throw new AppError('BILLING_DISABLED', 503, 'Kein Stripe-Preis konfiguriert')
  const customer = await getOrCreateCustomer(userId)
  // The session id is echoed back on the success URL so the client can reconcile
  // the plan immediately, without waiting for the (possibly delayed) webhook.
  const successBase = env.STRIPE_SUCCESS_URL ?? `${env.APP_PUBLIC_URL}/tabs/settings`
  const sep = successBase.includes('?') ? '&' : '?'
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: userId,
    success_url: `${successBase}${sep}upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: env.STRIPE_CANCEL_URL ?? `${env.APP_PUBLIC_URL}/tabs/settings`,
  })
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
  if (!billingEnabled()) return
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
  let user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } })
  // Mapping fallback: a checkout event carries client_reference_id (our userId).
  // If the customer→user link is missing (race with getOrCreateCustomer, or an
  // out-of-band customer), resolve by userId and heal the link.
  if (!user && fallbackUserId) {
    user = await prisma.user.findUnique({ where: { id: fallbackUserId } })
    if (user && !user.stripeCustomerId) {
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } })
    }
  }
  if (!user) {
    console.warn(`[billing] webhook for unknown Stripe customer ${customerId} — no user matched`)
    return
  }
  // Ordering guard: ignore events older than the last plan-affecting one we applied,
  // so a retried/out-of-order subscription event can't overwrite newer state.
  const eventAt = new Date(eventAtSec * 1000)
  if (user.lastStripeEventAt && eventAt < user.lastStripeEventAt) return
  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan,
      stripeSubscriptionId: subscriptionId ?? undefined,
      // Only set planUntil when a period end is present — do NOT reset it to null:
      // checkout.session.completed provides none, and if this event arrived after a
      // subscription.updated, it would otherwise erase a valid expiry date.
      ...(periodEndSec ? { planUntil: new Date(periodEndSec * 1000) } : {}),
      lastStripeEventAt: eventAt,
    },
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
    await applyPlanByCustomer(
      String(session.customer),
      'PRO',
      sub.id,
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
  // Record the event id and short-circuit on replay so every handler below runs
  // at most once per event (covers plan writes AND referral commissions).
  try {
    await prisma.processedStripeEvent.create({ data: { id: event.id, type: event.type } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return
    throw e
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const refUserId = session.client_reference_id ?? undefined
    if (session.customer && session.subscription) {
      // Load the subscription so planUntil is set immediately on upgrade
      // (the session itself carries no period end).
      const sub = await s.subscriptions.retrieve(String(session.subscription))
      await applyPlanByCustomer(String(session.customer), 'PRO', sub.id, subscriptionPeriodEnd(sub), event.created, refUserId)
    } else if (session.customer) {
      await applyPlanByCustomer(String(session.customer), 'PRO', null, null, event.created, refUserId)
    }
    return
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const active = sub.status === 'active' || sub.status === 'trialing'
    await applyPlanByCustomer(String(sub.customer), active ? 'PRO' : 'FREE', sub.id, subscriptionPeriodEnd(sub), event.created)
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
  // their referrer 20% (idempotent per invoice id).
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
    await recordCommissionForInvoice({
      referredUserId: payer.id,
      referrerId: payer.referredById,
      stripeInvoiceId: invoice.id,
      amountPaidCents: invoice.amount_paid,
      currency: invoice.currency,
    })
  }
}
