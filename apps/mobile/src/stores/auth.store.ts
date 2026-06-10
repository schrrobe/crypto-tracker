import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UserDto } from '@crypto-tracker/shared'
import { api, getRefreshToken, setTokens } from '../services/api.client'

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
      if (refreshToken) {
        try {
          const res = await api.post<AuthResponse>('/auth/refresh', { refreshToken })
          setTokens(res)
          user.value = res.user
        } catch {
          setTokens(null)
        }
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
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      await api.post('/auth/logout', { refreshToken }).catch(() => {})
    }
    setTokens(null)
    user.value = null
  }

  function sessionExpired() {
    setTokens(null)
    user.value = null
  }

  return { user, initialized, init, register, login, logout, sessionExpired }
})
