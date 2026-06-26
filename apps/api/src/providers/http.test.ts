import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError } from './provider.types'
import { bigIntFromJson, bigIntsFromJson, httpJson, parseRetryAfter, solanaRpc } from './http'

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

  it('wirft PROVIDER_ERROR statt rohem SyntaxError bei ungültigem JSON (200)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, 'not json')))
    await expect(httpJson('https://x.test')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
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

  it('wirft PROVIDER_ERROR, wenn das 200-Envelope weder result noch error trägt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { jsonrpc: '2.0', id: 1 })))
    await expect(solanaRpc('getThing', [])).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('wirft PROVIDER_ERROR bei ungültigem JSON statt rohem SyntaxError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, '{kaputt')))
    await expect(solanaRpc('getThing', [])).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})

describe('parseRetryAfter', () => {
  it('liest delta-seconds als Millisekunden', () => {
    expect(parseRetryAfter('5')).toBe(5000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('liest ein HTTP-Datum als ms ab jetzt (Zukunft positiv, Vergangenheit 0)', () => {
    const future = new Date(Date.now() + 10_000).toUTCString()
    const ms = parseRetryAfter(future)
    expect(ms).not.toBeNull()
    expect(ms!).toBeGreaterThan(0)
    expect(ms!).toBeLessThanOrEqual(10_000)
    expect(parseRetryAfter(new Date(Date.now() - 10_000).toUTCString())).toBe(0)
  })

  it('gibt null bei fehlendem oder unparsbarem Wert', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter(undefined)).toBeNull()
    expect(parseRetryAfter('übermorgen')).toBeNull()
  })

  it('httpRaw wartet Retry-After ab und liefert danach das Ergebnis', async () => {
    const fn = vi.fn()
    fn.mockResolvedValueOnce(res(429, {}, { 'retry-after': '0' }))
    fn.mockResolvedValueOnce(res(200, { ok: true }))
    vi.stubGlobal('fetch', fn)
    await expect(httpJson('https://x.test')).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('deckelt ein riesiges Retry-After auf timeoutMs statt stundenlang zu schlafen', async () => {
    const fn = vi.fn()
    fn.mockResolvedValueOnce(res(429, {}, { 'retry-after': '86400' })) // 1 Tag
    fn.mockResolvedValueOnce(res(200, { ok: true }))
    vi.stubGlobal('fetch', fn)
    // timeoutMs: 20 → sleep is clamped to 20ms; the test would hang ~24h if uncapped.
    await expect(httpJson('https://x.test', { timeoutMs: 20 })).resolves.toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
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

describe('bigIntsFromJson', () => {
  it('liest alle Vorkommen verlustfrei in Dokumentreihenfolge', () => {
    const text = '[{"lamports":9007199254740993},{"lamports":5000000000}]'
    expect(bigIntsFromJson(text, 'lamports')).toEqual([9007199254740993n, 5000000000n])
  })

  it('liefert ein leeres Array, wenn der Schlüssel fehlt', () => {
    expect(bigIntsFromJson('[]', 'lamports')).toEqual([])
  })
})
