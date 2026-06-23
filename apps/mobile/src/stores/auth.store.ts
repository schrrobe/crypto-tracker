import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserDto } from '@crypto-tracker/shared'
import { api, getRefreshToken, isNativePlatform, setTokens } from '../services/api.client'
import { useSurveysStore } from './surveys.store'

interface AuthResponse {
  user: UserDto
  accessToken: string
  refreshToken: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserDto | null>(null)
  const initialized = ref(false)
  const isPro = computed(() => user.value?.plan === 'PRO')
  let initPromise: Promise<void> | null = null

  // On app start: exchange an existing refresh token for a new session
  function init(): Promise<void> {
    initPromise ??= (async () => {
      const refreshToken = getRefreshToken()
      // Native without a stored token → no session. Web always attempts the
      // refresh (the httpOnly cookie carries the session, if present).
      if (isNativePlatform && !refreshToken) {
        initialized.value = true
        return
      }
      try {
        const res = await api.post<AuthResponse>(
          '/auth/refresh',
          refreshToken ? { refreshToken } : undefined,
        )
        setTokens(res)
        user.value = res.user
      } catch {
        setTokens(null)
      }
      initialized.value = true
    })()
    return initPromise
  }

  function applyAuth(res: AuthResponse) {
    setTokens(res)
    user.value = res.user
  }

  async function register(email: string, password: string, referralCode?: string): Promise<void> {
    applyAuth(await api.post<AuthResponse>('/auth/register', { email, password, referralCode }))
  }

  async function login(email: string, password: string): Promise<void> {
    applyAuth(await api.post<AuthResponse>('/auth/login', { email, password }))
  }

  async function logout(): Promise<void> {
    // Native: token in the body; web: cookie (no body) — the server deletes it.
    const refreshToken = getRefreshToken()
    await api.post('/auth/logout', refreshToken ? { refreshToken } : undefined).catch(() => {})
    setTokens(null)
    user.value = null
    useSurveysStore().reset()
  }

  async function updateBaseCurrency(baseCurrency: 'EUR' | 'USD'): Promise<void> {
    const res = await api.patch<{ user: UserDto }>('/auth/me', { baseCurrency })
    user.value = res.user
  }

  async function deleteAccount(): Promise<void> {
    await api.delete('/auth/me')
    setTokens(null)
    user.value = null
    useSurveysStore().reset()
  }

  async function setAutoSync(enabled: boolean): Promise<void> {
    const res = await api.patch<{ user: UserDto }>('/auth/me', { autoSyncEnabled: enabled })
    user.value = res.user
  }

  // Reload the plan (e.g. after returning from Stripe Checkout)
  async function refreshUser(): Promise<void> {
    const { user: u } = await api.get<{ user: UserDto }>('/auth/me')
    user.value = u
  }

  // Dev switch (only effective on local) to test the gating without Stripe
  async function setDevPlan(plan: 'FREE' | 'PRO'): Promise<void> {
    const { user: u } = await api.patch<{ user: UserDto }>('/auth/me', { plan })
    user.value = u
  }

  async function forgotPassword(email: string): Promise<void> {
    await api.post('/auth/forgot-password', { email })
  }

  async function resetPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/reset-password', { token, password })
  }

  function sessionExpired() {
    setTokens(null)
    user.value = null
    useSurveysStore().reset()
  }

  return {
    user,
    initialized,
    isPro,
    init,
    register,
    login,
    logout,
    updateBaseCurrency,
    forgotPassword,
    resetPassword,
    deleteAccount,
    refreshUser,
    setDevPlan,
    setAutoSync,
    sessionExpired,
  }
})
