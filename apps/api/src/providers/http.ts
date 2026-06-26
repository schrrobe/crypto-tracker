import { env } from '../config/env'
import { ProviderError } from './provider.types'

// Shared HTTP / JSON-RPC primitives for the provider layer.
//
//   ┌─ httpRaw ───────────────────────────────────────────────────┐
//   │ fetch + AbortSignal.timeout (real socket abort)             │
//   │ + bounded retry with exponential backoff + jitter          │
//   │ → { status, ok, text }   (no status→error mapping)         │
//   └───────────────┬─────────────────────────────┬──────────────┘
//        httpJson<T> (REST, e.g. mempool)     solanaRpc<T> / solanaRpcText (JSON-RPC)
//
// Centralizes the three things each provider used to re-implement by hand:
//  - a timeout that actually ABORTS the in-flight request (the old Promise.race
//    in sync.service left the socket running after it "timed out"),
//  - bounded retry with backoff+jitter on transient statuses, and
//  - status → ProviderError mapping.
//
// HTTP error *statuses* are returned, not thrown, by httpRaw — the caller maps
// them, because the same status means different things per provider
// (mempool 400 = bad address; a Solana 400 is a malformed RPC body).

// Transient HTTP statuses worth retrying. Everything else (esp. other 4xx) is
// terminal for the request. Mirrors RETRYABLE_HTTP_STATUS in wallets/solana.ts,
// which classifies the same set for the staking-reward cursor logic.
export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export interface HttpRawResult {
  status: number
  ok: boolean
  text: string
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  // Per-call overrides; default to env.PROVIDER_*.
  timeoutMs?: number
  retries?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Exponential backoff with full jitter. attempt is 0-based.
function backoffDelay(attempt: number): number {
  const ceil = env.PROVIDER_RETRY_BASE_MS * 2 ** attempt
  return Math.floor(ceil / 2 + Math.random() * (ceil / 2))
}

// Honor a Retry-After header (delta-seconds or HTTP-date); null if absent/unparseable.
// Exported for direct unit testing of both the seconds and HTTP-date branches.
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(value)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

// Core request with abort-on-timeout + bounded retry. Returns the final response
// body as text. Only abort/network failures that survive all retries throw
// (TIMEOUT for an aborted request, PROVIDER_ERROR for any other network throw).
//
// Retry safety: this tracker is read-only (no trading/withdrawals — see CLAUDE.md),
// so every provider call is idempotent and blind retry on a transient failure or
// timeout is safe. A future non-idempotent request MUST pass retries: 0.
export async function httpRaw(url: string, opts: RequestOptions = {}): Promise<HttpRawResult> {
  const timeoutMs = opts.timeoutMs ?? env.PROVIDER_TIMEOUT_MS
  const maxRetries = opts.retries ?? env.PROVIDER_MAX_RETRIES

  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        // AbortSignal.timeout aborts the underlying request (and frees the socket)
        // once the deadline passes — this is the actual fix for the leaked fetch.
        signal: AbortSignal.timeout(timeoutMs),
      })
      const text = await res.text()
      if (!res.ok && RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
        // Cap the server-provided Retry-After at timeoutMs: a hostile/buggy header
        // (e.g. "Retry-After: 86400") would otherwise park this shared helper for
        // hours, far past the intended bounded-retry window. Falls back to
        // backoff+jitter when the header is absent.
        const retryAfter = parseRetryAfter(res.headers?.get?.('retry-after'))
        await sleep(Math.min(retryAfter ?? backoffDelay(attempt), timeoutMs))
        continue
      }
      return { status: res.status, ok: res.ok, text }
    } catch (error) {
      // AbortSignal.timeout rejects with a TimeoutError; a manual abort gives AbortError.
      const isTimeout =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      if (attempt < maxRetries) {
        await sleep(backoffDelay(attempt))
        continue
      }
      if (isTimeout) {
        throw new ProviderError('TIMEOUT', `Zeitüberschreitung nach ${timeoutMs} ms`)
      }
      throw new ProviderError(
        'PROVIDER_ERROR',
        `Netzwerkfehler: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

// Keep JSON.parse failures inside the ProviderError contract the sync/mobile
// layers depend on: a 200 with a malformed body must surface a typed code, not a
// raw SyntaxError. label names the source for the German error text.
function parseProviderJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ProviderError('PROVIDER_ERROR', `${label}: ungültiges JSON`)
  }
}

export type StatusMapper = (status: number) => ProviderError

function defaultStatusMapper(status: number): ProviderError {
  if (status === 429) {
    return new ProviderError('RATE_LIMITED', `Rate-Limit erreicht (HTTP ${status})`, status)
  }
  return new ProviderError('PROVIDER_ERROR', `Anbieter antwortet mit ${status}`, status)
}

// REST helper for providers returning a plain JSON body (e.g. mempool.space).
// Pass mapStatus to customize the error for provider-specific statuses
// (mempool 400 → INVALID_ADDRESS); falls back to the default mapper otherwise.
export async function httpJson<T>(
  url: string,
  opts: RequestOptions & { mapStatus?: StatusMapper } = {},
): Promise<T> {
  const res = await httpRaw(url, opts)
  if (!res.ok) {
    throw (opts.mapStatus ?? defaultStatusMapper)(res.status)
  }
  return parseProviderJson<T>(res.text, 'Anbieterantwort')
}

export type Commitment = 'processed' | 'confirmed' | 'finalized'

export interface SolanaRpcOptions {
  commitment?: Commitment
  retries?: number
  timeoutMs?: number
}

// Solana JSON-RPC convention: per-request config (commitment, encoding, filters…)
// goes in a trailing object param. Merge commitment into that object if the call
// already has one, else append a fresh { commitment }. Callers that take NO config
// param (e.g. getBlockTime(slot)) must omit commitment.
function withCommitment(params: unknown[], commitment?: Commitment): unknown[] {
  if (!commitment) return params
  const last = params[params.length - 1]
  if (last && typeof last === 'object' && !Array.isArray(last)) {
    return [...params.slice(0, -1), { ...(last as object), commitment }]
  }
  return [...params, { commitment }]
}

// Returns the raw JSON-RPC response text after HTTP-status mapping only
// (429 → RATE_LIMITED, other non-2xx → PROVIDER_ERROR, both carrying res.status so
// the reward loop's isTransientRpcError can classify transient vs terminal).
// JSON-RPC *application* errors live in a 200 body and are handled by solanaRpc.
// Exposed raw so a caller can read a large integer field losslessly from the text
// before JSON.parse rounds it (see wallets/solana.ts getBalance).
export async function solanaRpcText(
  method: string,
  params: unknown[],
  opts: SolanaRpcOptions = {},
): Promise<string> {
  const res = await httpRaw(env.SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: withCommitment(params, opts.commitment) }),
    retries: opts.retries,
    timeoutMs: opts.timeoutMs,
  })
  if (res.status === 429) {
    throw new ProviderError('RATE_LIMITED', 'Solana-RPC Rate-Limit erreicht, bitte später erneut', 429)
  }
  if (!res.ok) {
    throw new ProviderError('PROVIDER_ERROR', `Solana-RPC antwortet mit ${res.status}`, res.status)
  }
  return res.text
}

interface RpcEnvelope<T> {
  result?: T
  error?: { code: number; message: string }
}

// Parsed JSON-RPC call. Rejects on a JSON-RPC application error (no HTTP status
// attached, matching the prior behavior so isTransientRpcError treats it as a
// candidate pruned-epoch error rather than a retryable HTTP failure).
export async function solanaRpc<T>(
  method: string,
  params: unknown[],
  opts: SolanaRpcOptions = {},
): Promise<T> {
  const text = await solanaRpcText(method, params, opts)
  const json = parseProviderJson<RpcEnvelope<T>>(text, 'Solana-RPC')
  if (json.error) {
    throw new ProviderError('PROVIDER_ERROR', `Solana-RPC: ${json.error.message}`)
  }
  // A 200 carrying neither result nor error is a protocol violation; surface it as
  // a typed error instead of silently returning undefined to the caller.
  if (!('result' in json)) {
    throw new ProviderError('PROVIDER_ERROR', 'Solana-RPC: Ergebnis fehlt')
  }
  return json.result as T
}

// Lossless read of a JSON integer field that can exceed Number.MAX_SAFE_INTEGER
// (2^53). JSON.parse would silently round such a value to the nearest float64;
// we instead pull the digits straight from the response text and BigInt() them.
// Used for Solana lamport balances (a whale/exchange account > ~9M SOL exceeds 2^53).
export function bigIntFromJson(text: string, key: string): bigint {
  const match = new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`).exec(text)
  if (!match) {
    throw new ProviderError('PROVIDER_ERROR', `Antwortfeld "${key}" fehlt oder ist nicht ganzzahlig`)
  }
  return BigInt(match[1]!)
}

// Like bigIntFromJson but for a key that repeats across an array response (e.g. the
// per-account lamports in getProgramAccounts). Returns every match in document
// order so the caller can zip it back onto the structurally-parsed elements.
export function bigIntsFromJson(text: string, key: string): bigint[] {
  const re = new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`, 'g')
  const out: bigint[] = []
  for (let match = re.exec(text); match; match = re.exec(text)) {
    out.push(BigInt(match[1]!))
  }
  return out
}
