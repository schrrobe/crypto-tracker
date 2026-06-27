import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { registerUser } from './helpers'

// Mock the Stripe SDK: constructEvent returns a prepared event, the rest
// is not needed in the webhook path.
let fakeEvent: unknown
vi.mock('stripe', () => ({
  default: class {
    webhooks = { constructEvent: () => fakeEvent }
    // checkout.session.completed loads the subscription afterwards (planUntil)
    subscriptions = { retrieve: async (id: string) => ({ id, status: 'active' }) }
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
      id: `evt_pro_${user.userId}`,
      created: 1000,
      type: 'checkout.session.completed',
      data: { object: { customer, subscription: 'sub_1', client_reference_id: user.userId } },
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
      id: `evt_del_${user.userId}`,
      created: 2000,
      type: 'customer.subscription.deleted',
      data: { object: { customer, id: 'sub_2', status: 'canceled' } },
    }

    const { handleWebhookEvent } = await import('../modules/billing/billing.service')
    await handleWebhookEvent(Buffer.from('{}'), 'sig')

    const updated = await prisma.user.findUnique({ where: { id: user.userId } })
    expect(updated?.plan).toBe('FREE')
  })

  it('replayed event id is a no-op (idempotency)', async () => {
    const user = await registerUser('wh-replay', 'FREE')
    const customer = `cus_${user.userId}`
    await prisma.user.update({ where: { id: user.userId }, data: { stripeCustomerId: customer } })
    fakeEvent = {
      id: `evt_replay_${user.userId}`,
      created: 1000,
      type: 'checkout.session.completed',
      data: { object: { customer, subscription: 'sub_r', client_reference_id: user.userId } },
    }
    const { handleWebhookEvent } = await import('../modules/billing/billing.service')
    await handleWebhookEvent(Buffer.from('{}'), 'sig') // → PRO

    // Simulate a downstream regression, then replay the SAME event id.
    await prisma.user.update({ where: { id: user.userId }, data: { plan: 'FREE' } })
    await handleWebhookEvent(Buffer.from('{}'), 'sig') // replay → skipped

    expect((await prisma.user.findUnique({ where: { id: user.userId } }))?.plan).toBe('FREE')
  })

  it('out-of-order older event is ignored (ordering guard)', async () => {
    const user = await registerUser('wh-order', 'FREE')
    const customer = `cus_${user.userId}`
    await prisma.user.update({ where: { id: user.userId }, data: { stripeCustomerId: customer } })
    const { handleWebhookEvent } = await import('../modules/billing/billing.service')

    // Newer event: active → PRO (created = 2000)
    fakeEvent = {
      id: `evt_new_${user.userId}`,
      created: 2000,
      type: 'customer.subscription.updated',
      data: { object: { customer, id: 'sub_o', status: 'active' } },
    }
    await handleWebhookEvent(Buffer.from('{}'), 'sig')

    // Older event arrives late: canceled (created = 1000) → must be ignored
    fakeEvent = {
      id: `evt_old_${user.userId}`,
      created: 1000,
      type: 'customer.subscription.deleted',
      data: { object: { customer, id: 'sub_o', status: 'canceled' } },
    }
    await handleWebhookEvent(Buffer.from('{}'), 'sig')

    expect((await prisma.user.findUnique({ where: { id: user.userId } }))?.plan).toBe('PRO')
  })
})
