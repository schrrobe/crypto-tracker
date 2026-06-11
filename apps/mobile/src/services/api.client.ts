// Fetch-Wrapper mit Bearer-Token und automatischem 401→Refresh→Retry.
// Access-Token lebt nur im Speicher; Refresh-Token in localStorage
// (wird in Meilenstein 9 durch @capacitor/preferences ersetzt).

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3010/api/v1'
const REFRESH_KEY = 'refresh-token'

let accessToken: string | null = null

export function setTokens(tokens: { accessToken: string; refreshToken: string } | null): void {
  accessToken = tokens?.accessToken ?? null
  if (tokens) localStorage.setItem(REFRESH_KEY, tokens.refreshToken)
  else localStorage.removeItem(REFRESH_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
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
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  })
}

// Ein laufender Refresh wird geteilt, damit parallele 401er nicht mehrfach rotieren
let refreshPromise: Promise<boolean> | null = null

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return false
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
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
    throw new ApiError(
      body?.error?.code ?? 'UNKNOWN',
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
