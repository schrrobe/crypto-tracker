import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError } from './provider.types'
import { bigIntFromJson, httpJson, solanaRpc } from './http'

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('httpJson', () => {
  it('parst den Body bei 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { hello: 'world' })))
    await expect(httpJson('https://x.test')).resolves.toEqual({ hello: 'world' })
  })

  it('wiederholt transiente Statuscodes und liefert dann das Ergebnis', async () => {
    const fn = vi.fn()
    fn.mockResolvedValueOnce(res(503, {}))
    fn.mockResolvedValueOnce(res(429, {}))
    fn.mockResolvedValueOnce(res(200, { ok: true }))
    vi.stubGlobal('fetch', fn)
    await expect(httpJson('https://x.test')).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('gibt nach erschöpften Retries den gemappten Fehler zurück', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(503, {})))
    await expect(httpJson('https://x.test')).rejects.toMatchObject({ code: 'PROVIDER_ERROR', status: 503 })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})))
    await expect(httpJson('https://x.test')).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
  })

  it('wiederholt terminale 4xx NICHT und nutzt mapStatus', async () => {
    const fn = vi.fn(async () => res(404, {}))
    vi.stubGlobal('fetch', fn)
    await expect(
      httpJson('https://x.test', {
        mapStatus: (s) => new ProviderError('INVALID_ADDRESS', `nope ${s}`, s),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ADDRESS', status: 404 })
    expect(fn).toHaveBeenCalledTimes(1) // 404 is terminal — no retry
  })

  it('wirft TIMEOUT, wenn der Request abbricht', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted')
        err.name = 'TimeoutError'
        throw err
      }),
    )
    await expect(httpJson('https://x.test')).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('respektiert die Anzahl der Retries (retries: 0)', async () => {
    const fn = vi.fn(async () => res(503, {}))
    vi.stubGlobal('fetch', fn)
    await expect(httpJson('https://x.test', { retries: 0 })).rejects.toBeInstanceOf(ProviderError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('solanaRpc', () => {
  it('liefert result und fügt das Commitment an', async () => {
    const fn = vi.fn(async (_url: string, _init: { body: string }) => res(200, { result: 42 }))
    vi.stubGlobal('fetch', fn)
    await expect(solanaRpc<number>('getThing', [], { commitment: 'finalized' })).resolves.toBe(42)
    const body = JSON.parse(fn.mock.calls[0]![1].body)
    expect(body.params).toContainEqual({ commitment: 'finalized' })
  })

  it('wirft PROVIDER_ERROR bei JSON-RPC-Fehler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { error: { code: -32602, message: 'bad' } })))
    await expect(solanaRpc('getThing', [])).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('mappt HTTP 429 auf RATE_LIMITED mit Status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})))
    await expect(solanaRpc('getThing', [], { retries: 0 })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 })
  })
})

describe('bigIntFromJson', () => {
  it('liest ganzzahlige Felder jenseits von 2^53 verlustfrei', () => {
    expect(bigIntFromJson('{"value":9007199254740993}', 'value')).toBe(9007199254740993n)
  })

  it('wirft, wenn das Feld fehlt', () => {
    expect(() => bigIntFromJson('{"other":1}', 'value')).toThrow(ProviderError)
  })
})
