import Stripe from 'stripe'
import type { Plan } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

// Billing ist nur aktiv, wenn ein Stripe-Secret konfiguriert ist. Ohne Key liefern
// die Endpunkte 503 (BILLING_DISABLED); lokal wird der Plan über den Dev-Schalter
// (PATCH /auth/me) getestet.
export function billingEnabled(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY)
}

// Stripe-Client bei Bedarf erzeugen (liest env zur Aufrufzeit → testbar, ohne den
// Schlüssel beim Modul-Import gesetzt haben zu müssen).
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
      planUntil: periodEndSec ? new Date(periodEndSec * 1000) : null,
    },
  })
}

// Webhook: Signatur prüfen, dann Plan anhand der Subscription setzen.
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
    if (session.customer) {
      await applyPlanByCustomer(String(session.customer), 'PRO', (session.subscription as string) ?? null)
    }
    return
  }
  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription
    const active = sub.status === 'active' || sub.status === 'trialing'
    await applyPlanByCustomer(
      String(sub.customer),
      active ? 'PRO' : 'FREE',
      sub.id,
      (sub as unknown as { current_period_end?: number }).current_period_end,
    )
  }
}
