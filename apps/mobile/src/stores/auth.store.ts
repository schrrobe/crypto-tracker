import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserDto } from '@crypto-tracker/shared'
import { api, getRefreshToken, isNativePlatform, setTokens } from '../services/api.client'

interface AuthResponse {
  user: UserDto
  accessToken: string
  refreshToken: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserDto | null>(null)
  const initialized = ref(false)
  let initPromise: Promise<void> | null = null

  // Beim App-Start: vorhandenen Refresh-Token gegen neue Session tauschen
  function init(): Promise<void> {
    initPromise ??= (async () => {
      const refreshToken = getRefreshToken()
      // Nativ ohne gespeicherten Token → keine Session. Web versucht immer den
      // Refresh (das httpOnly-Cookie trägt die Session, falls vorhanden).
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

  async function register(email: string, password: string): Promise<void> {
    applyAuth(await api.post<AuthResponse>('/auth/register', { email, password }))
  }

  async function login(email: string, password: string): Promise<void> {
    applyAuth(await api.post<AuthResponse>('/auth/login', { email, password }))
  }

  async function logout(): Promise<void> {
    // Nativ: Token im Body; Web: Cookie (kein Body) — Server löscht es.
    const refreshToken = getRefreshToken()
    await api.post('/auth/logout', refreshToken ? { refreshToken } : undefined).catch(() => {})
    setTokens(null)
    user.value = null
  }

  async function updateBaseCurrency(baseCurrency: 'EUR' | 'USD'): Promise<void> {
    const res = await api.patch<{ user: UserDto }>('/auth/me', { baseCurrency })
    user.value = res.user
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
  }

  return {
    user,
    initialized,
    init,
    register,
    login,
    logout,
    updateBaseCurrency,
    forgotPassword,
    resetPassword,
    sessionExpired,
  }
})
