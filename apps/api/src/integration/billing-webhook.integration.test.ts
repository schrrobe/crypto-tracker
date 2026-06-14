import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { registerUser } from './helpers'

// Stripe-SDK mocken: constructEvent liefert ein vorbereitetes Event, der Rest
// wird im Webhook-Pfad nicht gebraucht.
let fakeEvent: unknown
vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: () => fakeEvent }
  },
}))

describe('Stripe-Webhook (Integration)', () => {
  const origKey = env.STRIPE_SECRET_KEY
  const origWh = env.STRIPE_WEBHOOK_SECRET

  beforeEach(() => {
    env.STRIPE_SECRET_KEY = 'sk_test_x'
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  })
  afterEach(() => {
    env.STRIPE_SECRET_KEY = origKey
    env.STRIPE_WEBHOOK_SECRET = origWh
  })

  it('checkout.session.completed setzt plan=PRO für den Stripe-Customer', async () => {
    const user = await registerUser('wh-pro', 'FREE')
    const customer = `cus_${user.userId}`
    await prisma.user.update({ where: { id: user.userId }, data: { stripeCustomerId: customer } })
    fakeEvent = {
      type: 'checkout.session.completed',
      data: { object: { customer, subscription: 'sub_1' } },
    }

    const { handleWebhookEvent } = await import('../modules/billing/billing.service')
    await handleWebhookEvent(Buffer.from('{}'), 'sig')

    const updated = await prisma.user.findUnique({ where: { id: user.userId } })
    expect(updated?.plan).toBe('PRO')
    expect(updated?.stripeSubscriptionId).toBe('sub_1')
  })

  it('subscription.deleted setzt plan zurück auf FREE', async () => {
    const user = await registerUser('wh-free', 'PRO')
    const customer = `cus_${user.userId}`
    await prisma.user.update({ where: { id: user.userId }, data: { stripeCustomerId: customer } })
    fakeEvent = {
      type: 'customer.subscription.deleted',
      data: { object: { customer, id: 'sub_2', status: 'canceled' } },
    }

    const { handleWebhookEvent } = await import('../modules/billing/billing.service')
    await handleWebhookEvent(Buffer.from('{}'), 'sig')

    const updated = await prisma.user.findUnique({ where: { id: user.userId } })
    expect(updated?.plan).toBe('FREE')
  })
})
