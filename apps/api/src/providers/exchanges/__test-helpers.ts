import { vi } from 'vitest'

// Stub the global fetch with a single canned response and return the mock so
// tests can assert on the request (url, headers, body). Shared by the exchange
// provider tests — keep one definition instead of copying it per file.
export function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}
