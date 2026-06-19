import Stripe from 'stripe'
import type { Plan } from '@prisma/client'
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
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: userId,
    success_url: env.STRIPE_SUCCESS_URL ?? `${env.APP_PUBLIC_URL}/tabs/settings?upgrade=success`,
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
  periodEndSec?: number | null,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } })
  if (!user) return
  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan,
      stripeSubscriptionId: subscriptionId ?? undefined,
      // Only set planUntil when a period end is present — do NOT reset it to null:
      // checkout.session.completed provides none, and if this event arrived after a
      // subscription.updated, it would otherwise erase a valid expiry date.
      ...(periodEndSec ? { planUntil: new Date(periodEndSec * 1000) } : {}),
    },
  })
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (session.customer && session.subscription) {
      // Load the subscription so planUntil is set immediately on upgrade
      // (the session itself carries no period end).
      const sub = await s.subscriptions.retrieve(String(session.subscription))
      await applyPlanByCustomer(String(session.customer), 'PRO', sub.id, subscriptionPeriodEnd(sub))
    } else if (session.customer) {
      await applyPlanByCustomer(String(session.customer), 'PRO', null)
    }
    return
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const active = sub.status === 'active' || sub.status === 'trialing'
    await applyPlanByCustomer(String(sub.customer), active ? 'PRO' : 'FREE', sub.id, subscriptionPeriodEnd(sub))
    return
  }
  // Recurring referral commission: each paid invoice of an invited user credits
  // their referrer 20% (idempotent per invoice id).
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice
    if (!invoice.customer || !invoice.id || invoice.amount_paid <= 0) return
    const payer = await prisma.user.findUnique({
      where: { stripeCustomerId: String(invoice.customer) },
      select: { id: true, referredById: true },
    })
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
