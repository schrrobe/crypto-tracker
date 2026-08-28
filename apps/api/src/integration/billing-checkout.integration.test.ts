import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { env } from '../config/env'
import { registerUser } from './helpers'

let checkoutCreates = 0
let cancelFails = false

vi.mock('stripe', () => ({
  default: class {
    customers = {
      create: async (data: { metadata: { userId: string } }, _opts: { idempotencyKey?: string }) => ({
        id: `cus_${data.metadata.userId}`,
      }),
    }
    checkout = {
      sessions: {
        create: async () => {
          checkoutCreates += 1
          return { url: 'https://checkout.stripe.test/session' }
        },
      },
    }
    subscriptions = {
      cancel: async () => {
        if (cancelFails) throw new Error('Stripe unavailable')
      },
    }
  },
}))

describe('Billing checkout hardening (Integration)', () => {
  const original = {
    key: env.STRIPE_SECRET_KEY,
    price: env.STRIPE_PRICE_ID,
  }

  beforeEach(() => {
    env.STRIPE_SECRET_KEY = 'sk_test_checkout'
    env.STRIPE_PRICE_ID = 'price_checkout'
    checkoutCreates = 0
    cancelFails = false
  })

  afterEach(() => {
    env.STRIPE_SECRET_KEY = original.key
    env.STRIPE_PRICE_ID = original.price
  })

  it('reserviert parallele Checkout-Aufrufe und erstellt nur eine Session', async () => {
    const user = await registerUser('checkout-race', 'FREE')
    const { createCheckoutSession } = await import('../modules/billing/billing.service')

    const results = await Promise.allSettled([
      createCheckoutSession(user.userId),
      createCheckoutSession(user.userId),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'CHECKOUT_ALREADY_PENDING' } })
    expect(checkoutCreates).toBe(1)
  })

  it('blockiert Checkout bei bereits verknüpfter Subscription', async () => {
    const user = await registerUser('checkout-existing', 'FREE')
    await prisma.user.update({
      where: { id: user.userId },
      data: { stripeSubscriptionId: 'sub_existing' },
    })
    const { createCheckoutSession } = await import('../modules/billing/billing.service')

    await expect(createCheckoutSession(user.userId)).rejects.toMatchObject({ code: 'ALREADY_SUBSCRIBED' })
    expect(checkoutCreates).toBe(0)
  })

  it('behält das Konto, wenn Stripe die Kündigung nicht bestätigt', async () => {
    const user = await registerUser('delete-cancel-fail', 'FREE')
    await prisma.user.update({
      where: { id: user.userId },
      data: { stripeSubscriptionId: 'sub_uncanceled' },
    })
    cancelFails = true
    const { deleteAccount } = await import('../modules/auth/auth.service')

    await expect(deleteAccount(user.userId)).rejects.toMatchObject({ code: 'SUBSCRIPTION_CANCEL_FAILED' })
    expect(await prisma.user.findUnique({ where: { id: user.userId } })).not.toBeNull()
  })
})
