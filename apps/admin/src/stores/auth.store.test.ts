import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const post = vi.fn()
const setAccessToken = vi.fn()

vi.mock('../services/api.client', () => ({
  api: { post: (...a: unknown[]) => post(...a), get: vi.fn() },
  setAccessToken: (...a: unknown[]) => setAccessToken(...a),
}))

import { useAuthStore } from './auth.store'

const ADMIN = { id: 'u1', email: 'a@x.de', plan: 'PRO' as const, isAdmin: true }

describe('auth.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    post.mockReset()
    setAccessToken.mockReset()
  })

  it('login sets user and stores access token', async () => {
    post.mockResolvedValueOnce({ user: ADMIN, accessToken: 'tok-1' })
    const store = useAuthStore()
    await store.login('a@x.de', 'pw')
    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'a@x.de', password: 'pw' })
    expect(setAccessToken).toHaveBeenCalledWith('tok-1')
    expect(store.user).toEqual(ADMIN)
  })

  it('logout clears user and token', async () => {
    post.mockResolvedValueOnce({ user: ADMIN, accessToken: 'tok-1' })
    const store = useAuthStore()
    await store.login('a@x.de', 'pw')

    post.mockResolvedValueOnce(undefined)
    await store.logout()
    expect(store.user).toBeNull()
    expect(setAccessToken).toHaveBeenLastCalledWith(null)
  })
})
