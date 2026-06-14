// Fetch wrapper with bearer token and automatic 401→refresh→retry.
// The access token lives in memory only. Refresh-token transport per platform:
//   native → encrypted Secure Storage (Keychain/Keystore), sent in the body
//   web    → httpOnly cookie (unreadable to JS), sent automatically by the browser
// Native clients signal this via the X-Client: native header.

import { Capacitor } from '@capacitor/core'
import { getStored, removeStored, setStored } from './storage'

// Dev: if VITE_API_URL is unset, derive the API host from where the app is
// served — so the same build works on localhost and over the LAN (phone uses
// the host's IP automatically). Native builds always set VITE_API_URL.
function resolveBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:3010/api/v1`
  }
  return 'http://localhost:3010/api/v1'
}

const BASE_URL = resolveBaseUrl()
const REFRESH_KEY = 'refresh-token'

export const isNativePlatform = Capacitor.isNativePlatform()

let accessToken: string | null = null

export function setTokens(tokens: { accessToken: string; refreshToken?: string } | null): void {
  accessToken = tokens?.accessToken ?? null
  // Web: the refresh token lives in the httpOnly cookie → store nothing in JS.
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
  // For FormData the browser sets the Content-Type (multipart boundary) itself
  const isFormData = init?.body instanceof FormData
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include', // send the httpOnly refresh cookie along (web)
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(isNativePlatform ? { 'X-Client': 'native' } : {}),
      ...init?.headers,
    },
  })
}

// A running refresh is shared so that parallel 401s don't rotate multiple times
let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    // Native needs the stored token (body); web uses the cookie (no body).
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
    // Pro gate hit → open the paywall globally (App.vue listens for this)
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
