import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// These tests check the native path (refresh token in body + Secure Storage).
// The web cookie path is covered by the backend integration test.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))

// api.client holds module state (accessToken, shared refresh promise) —
// each test gets a fresh module instance.
async function loadClient() {
  vi.resetModules()
  return await import('./api.client')
}

type FetchHandler = (url: string, init: RequestInit) => { status: number; body?: unknown }

function mockFetch(handler: FetchHandler) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const { status, body } = handler(url, init)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('api.client', () => {
  it('hängt den Bearer-Token an und parst JSON', async () => {
    const { api, setTokens } = await loadClient()
    setTokens({ accessToken: 'token-1', refreshToken: 'refresh-1' })
    const fn = mockFetch(() => ({ status: 200, body: { hello: 'welt' } }))

    const result = await api.get<{ hello: string }>('/health')
    expect(result.hello).toBe('welt')
    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
  })

  it('401 → Refresh → Retry mit neuem Token', async () => {
    const { api, setTokens, getRefreshToken } = await loadClient()
    setTokens({ accessToken: 'alt', refreshToken: 'refresh-alt' })

    const calls: string[] = []
    mockFetch((url, init) => {
      calls.push(url)
      if (url.endsWith('/auth/refresh')) {
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'refresh-alt' })
        return { status: 200, body: { accessToken: 'neu', refreshToken: 'refresh-neu' } }
      }
      const token = (init.headers as Record<string, string>).Authorization
      if (token === 'Bearer alt') return { status: 401, body: { error: { code: 'UNAUTHORIZED' } } }
      return { status: 200, body: { ok: true } }
    })

    const result = await api.get<{ ok: boolean }>('/holdings')
    expect(result.ok).toBe(true)
    expect(calls.filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(1)
    expect(getRefreshToken()).toBe('refresh-neu') // rotated token is persisted
  })

  it('parallele 401er teilen sich einen einzigen Refresh', async () => {
    const { api, setTokens } = await loadClient()
    setTokens({ accessToken: 'alt', refreshToken: 'refresh-alt' })

    let refreshCalls = 0
    mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1
        return { status: 200, body: { accessToken: 'neu', refreshToken: 'refresh-neu' } }
      }
      const token = (init.headers as Record<string, string>).Authorization
      return token === 'Bearer alt'
        ? { status: 401, body: {} }
        : { status: 200, body: { ok: true } }
    })

    const [a, b] = await Promise.all([api.get('/holdings'), api.get('/sources')])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(refreshCalls).toBe(1)
  })

  it('fehlgeschlagener Refresh: Tokens weg, auth:expired-Event, Fehler propagiert', async () => {
    const { api, setTokens, getRefreshToken } = await loadClient()
    setTokens({ accessToken: 'alt', refreshToken: 'refresh-abgelaufen' })

    const expired = vi.fn()
    window.addEventListener('auth:expired', expired)
    mockFetch((url) =>
      url.endsWith('/auth/refresh')
        ? { status: 401, body: {} }
        : { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Nicht angemeldet' } } },
    )

    await expect(api.get('/holdings')).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledTimes(1)
    expect(getRefreshToken()).toBeNull()
  })

  it('Auth-Routen lösen keinen Refresh-Loop aus', async () => {
    const { api, setTokens } = await loadClient()
    setTokens({ accessToken: 'alt', refreshToken: 'vorhanden' })
    const fn = mockFetch(() => ({ status: 401, body: { error: { code: 'UNAUTHORIZED' } } }))

    await expect(api.post('/auth/login', { email: 'a@b.c', password: 'x' })).rejects.toMatchObject({
      status: 401,
    })
    expect(fn).toHaveBeenCalledTimes(1) // no follow-up /auth/refresh call
  })

  it('FormData-Upload setzt keinen JSON-Content-Type', async () => {
    const { api } = await loadClient()
    const fn = mockFetch(() => ({ status: 201, body: { done: true } }))

    const form = new FormData()
    form.append('kind', 'BALANCES')
    await api.upload('/imports', form)

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
    expect(init.body).toBe(form)
  })

  it('204 liefert undefined statt JSON-Parse-Fehler', async () => {
    const { api, setTokens } = await loadClient()
    setTokens({ accessToken: 't', refreshToken: 'r' })
    mockFetch(() => ({ status: 204 }))
    await expect(api.delete('/sources/abc')).resolves.toBeUndefined()
  })

  it('API-Fehler werden als ApiError mit Code und Message geworfen', async () => {
    const { api, ApiError, setTokens } = await loadClient()
    setTokens({ accessToken: 't', refreshToken: 'r' })
    mockFetch(() => ({
      status: 409,
      body: { error: { code: 'EMAIL_TAKEN', message: 'Diese E-Mail-Adresse ist bereits registriert' } },
    }))

    const error = (await api.post('/x').catch((e) => e)) as InstanceType<typeof ApiError>
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('EMAIL_TAKEN')
    expect(error.status).toBe(409)
  })
})
