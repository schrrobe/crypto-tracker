// Fetch-Wrapper mit Bearer-Token und automatischem 401→Refresh→Retry.
// Access-Token lebt nur im Speicher. Refresh-Token-Transport je Plattform:
//   nativ  → verschlüsseltes Secure Storage (Keychain/Keystore), im Body gesendet
//   web    → httpOnly-Cookie (für JS unlesbar), automatisch vom Browser gesendet
// Native Clients signalisieren das per Header X-Client: native.

import { Capacitor } from '@capacitor/core'
import { getStored, removeStored, setStored } from './storage'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3010/api/v1'
const REFRESH_KEY = 'refresh-token'

export const isNativePlatform = Capacitor.isNativePlatform()

let accessToken: string | null = null

export function setTokens(tokens: { accessToken: string; refreshToken?: string } | null): void {
  accessToken = tokens?.accessToken ?? null
  // Web: Refresh-Token liegt im httpOnly-Cookie → nichts in JS speichern.
  if (!isNativePlatform) return
  if (tokens?.refreshToken) setStored(REFRESH_KEY, tokens.refreshToken)
  else removeStored(REFRESH_KEY)
}

export function getRefreshToken(): string | null {
  return isNativePlatform ? getStored(REFRESH_KEY) : null
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

async function rawRequest(path: string, init?: RequestInit): Promise<Response> {
  // Bei FormData setzt der Browser den Content-Type (multipart boundary) selbst
  const isFormData = init?.body instanceof FormData
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include', // httpOnly-Refresh-Cookie mitsenden (Web)
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(isNativePlatform ? { 'X-Client': 'native' } : {}),
      ...init?.headers,
    },
  })
}

// Ein laufender Refresh wird geteilt, damit parallele 401er nicht mehrfach rotieren
let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    // Nativ braucht den gespeicherten Token (Body); Web nutzt das Cookie (kein Body).
    let body: string | undefined
    if (isNativePlatform) {
      const refreshToken = getRefreshToken()
      if (!refreshToken) return false
      body = JSON.stringify({ refreshToken })
    }
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(isNativePlatform ? { 'X-Client': 'native' } : {}),
      },
      body,
    })
    if (!res.ok) {
      setTokens(null)
      return false
    }
    const data = await res.json()
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
    return true
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await rawRequest(path, init)

  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      res = await rawRequest(path, init)
    } else {
      window.dispatchEvent(new CustomEvent('auth:expired'))
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const code = body?.error?.code ?? 'UNKNOWN'
    // Pro-Gate getroffen → global die Paywall öffnen (App.vue lauscht darauf)
    if (res.status === 402 || code === 'PLAN_UPGRADE_REQUIRED') {
      window.dispatchEvent(new CustomEvent('plan:upgrade'))
    }
    throw new ApiError(
      code,
      res.status,
      body?.error?.message ?? `Request fehlgeschlagen (${res.status})`,
      body?.error?.details,
    )
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}
