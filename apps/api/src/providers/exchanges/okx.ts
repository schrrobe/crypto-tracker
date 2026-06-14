import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeAccountSnapshot,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
  type RawPosition,
} from '../provider.types'
import { safeSubFetch } from './account-snapshot'

// OKX REST API v5: GET /api/v5/account/balance mit HMAC-SHA256-Signatur (Base64).
// Benötigt einen API-Key mit ausschließlich "Read"-Berechtigung plus Passphrase.

const BASE_URL = 'https://www.okx.com'
const BALANCE_PATH = '/api/v5/account/balance'

// OK-ACCESS-SIGN = Base64(HMAC-SHA256(timestamp + method + requestPath + body, secret))
// timestamp im ISO-8601-Format (z.B. 2020-12-08T09:08:57.715Z), body bei GET leer
export function okxSignature(
  timestamp: string,
  method: string,
  requestPath: string,
  body: string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}${method}${requestPath}${body}`).digest('base64')
}

interface OkxBalanceResponse {
  code: string
  msg?: string
  data?: { details?: { ccy: string; cashBal: string }[] }[]
}

// Auth-Fehlercodes: 50103–50107 (fehlende/ungültige Auth-Header), 50105 (Passphrase falsch),
// 50111 (ungültiger OK-ACCESS-KEY), 50113 (ungültige Signatur), 50114 (ungültige Autorisierung)
const AUTH_CODES = new Set(['50103', '50104', '50105', '50106', '50107', '50111', '50113', '50114'])

function classifyOkxError(code: string, msg: string | undefined): ProviderError {
  const message = `OKX: ${msg ?? `Code ${code}`}`
  if (AUTH_CODES.has(code)) return new ProviderError('INVALID_API_KEY', message)
  // 50011 = Rate-Limit erreicht
  if (code === '50011') return new ProviderError('RATE_LIMITED', message)
  return new ProviderError('PROVIDER_ERROR', message)
}

async function fetchOkxBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'OKX: API-Secret fehlt')
  if (!creds.passphrase) throw new ProviderError('INVALID_API_KEY', 'OKX: Passphrase fehlt')
  const timestamp = new Date().toISOString()

  const res = await fetch(`${BASE_URL}${BALANCE_PATH}`, {
    headers: {
      'OK-ACCESS-KEY': creds.apiKey,
      'OK-ACCESS-SIGN': okxSignature(timestamp, 'GET', BALANCE_PATH, '', creds.apiSecret),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': creds.passphrase,
    },
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'OKX Rate-Limit erreicht')
  // OKX liefert den Fehlercode auch bei HTTP-Fehlern im Body — dort genauer klassifizieren
  const json = (await res.json().catch(() => null)) as OkxBalanceResponse | null
  if (!json) {
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('INVALID_API_KEY', `OKX: HTTP ${res.status}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `OKX antwortet mit ${res.status}`)
  }
  if (json.code !== '0') {
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('INVALID_API_KEY', `OKX: ${json.msg ?? `Code ${json.code}`}`)
    }
    throw classifyOkxError(json.code, json.msg)
  }

  const balances: RawBalance[] = []
  for (const account of json.data ?? []) {
    for (const detail of account.details ?? []) {
      // cashBal = Gesamtbestand (verfügbar + eingefroren) der Währung; negativ =
      // Cross-/Unified-Margin-Verbindlichkeit (wie Binance netAsset behalten, nur exakt 0 verwerfen)
      if (Number(detail.cashBal) !== 0) {
        balances.push({ symbol: detail.ccy.toUpperCase(), amount: detail.cashBal })
      }
    }
  }
  return balances
}

// Signierter GET auf einen OKX-Subendpoint. Auth-Fehler hier ⇒ ENDPOINT_FORBIDDEN
// (Key ohne Berechtigung für diesen Kontotyp), Spot-Sync läuft weiter.
async function okxSubGet<T>(path: string, creds: ExchangeCredentials): Promise<T[]> {
  const timestamp = new Date().toISOString()
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'OK-ACCESS-KEY': creds.apiKey,
      'OK-ACCESS-SIGN': okxSignature(timestamp, 'GET', path, '', creds.apiSecret as string),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': creds.passphrase as string,
    },
  })
  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'OKX Rate-Limit erreicht')
  const json = (await res.json().catch(() => null)) as { code: string; msg?: string; data?: T[] } | null
  if (!json || json.code !== '0') {
    if (res.status === 401 || res.status === 403 || (json && AUTH_CODES.has(json.code))) {
      throw new ProviderError('ENDPOINT_FORBIDDEN', `OKX: ${json?.msg ?? `HTTP ${res.status}`}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `OKX: ${json?.msg ?? `HTTP ${res.status}`}`)
  }
  return json.data ?? []
}

interface OkxSavings {
  ccy: string
  amt: string
}

// Simple Earn (Savings) → EARN
export async function fetchOkxEarn(creds: ExchangeCredentials): Promise<RawBalance[]> {
  const data = await okxSubGet<OkxSavings>('/api/v5/finance/savings/balance', creds)
  const balances: RawBalance[] = []
  for (const s of data) {
    if (Number(s.amt) > 0) balances.push({ symbol: s.ccy.toUpperCase(), amount: s.amt, accountType: 'EARN' })
  }
  return balances
}

interface OkxPosition {
  instId: string
  posSide: string
  pos: string
  avgPx?: string
  markPx?: string
  lever?: string
  upl?: string
  liqPx?: string
}

export function parseOkxPositions(data: OkxPosition[]): RawPosition[] {
  const positions: RawPosition[] = []
  for (const p of data) {
    const pos = Number(p.pos)
    if (pos === 0) continue
    const [base, quote] = p.instId.split('-')
    const side = p.posSide === 'long' || (p.posSide === 'net' && pos > 0) ? 'LONG' : 'SHORT'
    positions.push({
      rawSymbol: p.instId,
      baseSymbol: (base ?? p.instId).toUpperCase(),
      side,
      // Vorzeichen über Number, Größe als String (keine float-Präzisionsverluste)
      size: p.pos.replace(/^-/, ''),
      entryPrice: p.avgPx,
      markPrice: p.markPx,
      leverage: p.lever ? Number(p.lever) : undefined,
      unrealizedPnl: p.upl,
      quoteCurrency: quote?.toUpperCase(),
      liquidationPrice: p.liqPx,
    })
  }
  return positions
}

export async function fetchOkxPositions(creds: ExchangeCredentials): Promise<RawPosition[]> {
  return parseOkxPositions(await okxSubGet<OkxPosition>('/api/v5/account/positions', creds))
}

export const okxProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'OKX',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Balance ist ein reiner Lese-Endpoint — validiert Key, Secret und Passphrase
    await fetchOkxBalances(creds)
  },

  fetchBalances: fetchOkxBalances,

  // Unified-Account: Spot+Margin teilen sich balance → nur explizites Earn separat;
  // dazu offene Swap-/Futures-Positionen.
  async fetchAccount(creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot> {
    const warnings: string[] = []
    const balances = await fetchOkxBalances(creds)
    balances.push(...(await safeSubFetch(() => fetchOkxEarn(creds), 'OKX Earn', warnings)))
    let positions: RawPosition[] = []
    try {
      positions = await fetchOkxPositions(creds)
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'ENDPOINT_FORBIDDEN') {
        warnings.push(`OKX Positionen: ${err.message}`)
      } else throw err
    }
    return { balances, positions, warnings }
  },
}
