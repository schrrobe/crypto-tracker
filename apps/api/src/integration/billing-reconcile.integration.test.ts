import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { registerUser } from './helpers'

// Mock Stripe: reconcile retrieves the checkout session and its subscription.
let fakeSession: unknown
vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { retrieve: async (_id: string) => fakeSession } }
    subscriptions = { retrieve: async (id: string) => ({ id, status: 'active' }) }
  },
}))

describe('Billing reconcile (Integration)', () => {
  const origKey = env.STRIPE_SECRET_KEY
  beforeEach(() => {
    env.STRIPE_SECRET_KEY = 'sk_test_x'
  })
  afterEach(() => {
    env.STRIPE_SECRET_KEY = origKey
  })

  it('paid session for the caller flips plan to PRO (covers a dropped webhook)', async () => {
    const user = await registerUser('rec-pro', 'FREE')
    const customer = `cus_${user.userId}`
    await prisma.user.update({ where: { id: user.userId }, data: { stripeCustomerId: customer } })
    fakeSession = {
      client_reference_id: user.userId,
      payment_status: 'paid',
      customer,
      subscription: 'sub_x',
    }

    const { reconcileCheckoutSession } = await import('../modules/billing/billing.service')
    const result = await reconcileCheckoutSession(user.userId, 'cs_x')

    expect(result.plan).toBe('PRO')
    expect((await prisma.user.findUnique({ where: { id: user.userId } }))?.plan).toBe('PRO')
  })

  it('foreign session is rejected (404), plan unchanged', async () => {
    const user = await registerUser('rec-foreign', 'FREE')
    await prisma.user.update({ where: { id: user.userId }, data: { stripeCustomerId: `cus_${user.userId}` } })
    fakeSession = {
      client_reference_id: 'someone-else',
      payment_status: 'paid',
      customer: 'cus_attacker',
      subscription: 'sub_y',
    }

    const { reconcileCheckoutSession } = await import('../modules/billing/billing.service')
    await expect(reconcileCheckoutSession(user.userId, 'cs_y')).rejects.toMatchObject({ status: 404 })
    expect((await prisma.user.findUnique({ where: { id: user.userId } }))?.plan).toBe('FREE')
  })
})
