import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, setAccessToken } from '../services/api.client'

interface UserDto {
  id: string
  email: string
  plan: 'FREE' | 'PRO'
  isAdmin: boolean
}

interface AuthResponse {
  user: UserDto
  accessToken: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserDto | null>(null)
  const ready = ref(false)

  function apply(res: AuthResponse): void {
    setAccessToken(res.accessToken)
    user.value = res.user
  }

  async function login(email: string, password: string): Promise<void> {
    apply(await api.post<AuthResponse>('/auth/login', { email, password }))
  }

  // Restore a session on first load via the refresh cookie, then fetch the user.
  async function init(): Promise<void> {
    if (ready.value) return
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:3010/api/v1`}/auth/refresh`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } },
      )
      if (res.ok) {
        const data = await res.json()
        setAccessToken(data.accessToken)
        user.value = (await api.get<{ user: UserDto }>('/auth/me')).user
      }
    } catch {
      // not logged in
    } finally {
      ready.value = true
    }
  }

  async function logout(): Promise<void> {
    await api.post('/auth/logout').catch(() => undefined)
    setAccessToken(null)
    user.value = null
  }

  return { user, ready, login, init, logout }
})
