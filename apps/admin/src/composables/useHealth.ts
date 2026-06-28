import { ref, computed } from 'vue'
import type { AdminHealthDto, AdminHealthCheckDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'

// The backend reports ok | down | skipped. We derive a 4th client-side state,
// 'degraded', from latencyMs so a slow-but-reachable dependency stops reading
// as fully healthy. Internal deps (DB, queue) are held to a tighter budget than
// external ones (CoinGecko, SMTP) which legitimately take longer.
export type DisplayState = 'ok' | 'degraded' | 'down' | 'skipped'
export type CheckName = AdminHealthCheckDto['name']

export interface DisplayCheck {
  name: CheckName
  state: DisplayState
  latencyMs: number | null
  detail: string | null
}

export type OverallLevel = 'ok' | 'degraded' | 'down' | 'skipped' | 'loading'
export interface Overall {
  level: OverallLevel
  label: string
}

const INTERNAL: ReadonlySet<CheckName> = new Set<CheckName>(['database', 'redis'])
const DEGRADED_INTERNAL_MS = 1000
const DEGRADED_EXTERNAL_MS = 2500

// Severity-first so the eye lands on problems, healthy/skipped sink to the end.
const SORT_ORDER: Record<DisplayState, number> = { down: 0, degraded: 1, ok: 2, skipped: 3 }

function toDisplay(c: AdminHealthCheckDto): DisplayCheck {
  let state: DisplayState = c.state
  if (c.state === 'ok' && c.latencyMs !== null) {
    const budget = INTERNAL.has(c.name) ? DEGRADED_INTERNAL_MS : DEGRADED_EXTERNAL_MS
    if (c.latencyMs > budget) state = 'degraded'
  }
  return { name: c.name, state, latencyMs: c.latencyMs, detail: c.detail }
}

export function useHealth() {
  const data = ref<AdminHealthDto | null>(null)
  const refreshing = ref(false)
  const lastSuccessAt = ref<Date | null>(null)
  // True when the most recent tick failed while we still hold prior values —
  // drives the "Stand veraltet" honesty signal instead of showing a stale
  // success time as if it were current.
  const lastTickFailed = ref(false)

  const checks = computed<DisplayCheck[]>(() => (data.value?.checks ?? []).map(toDisplay))
  const sortedChecks = computed<DisplayCheck[]>(() =>
    [...checks.value].sort((a, b) => SORT_ORDER[a.state] - SORT_ORDER[b.state]),
  )

  const loading = computed(() => data.value === null && !lastTickFailed.value)
  const isStale = computed(() => lastTickFailed.value && data.value !== null)

  const overall = computed<Overall>(() => {
    if (data.value === null) return { level: 'loading', label: 'Systemstatus wird geprüft …' }
    const cs = checks.value
    const down = cs.filter((c) => c.state === 'down')
    if (down.length) return { level: 'down', label: `${down.length} von ${cs.length} Diensten gestört` }
    if (cs.some((c) => c.state === 'degraded')) return { level: 'degraded', label: 'Betrieb eingeschränkt' }
    const active = cs.filter((c) => c.state !== 'skipped')
    if (active.length === 0)
      return { level: 'skipped', label: 'Alle externen Dienste übersprungen (lokale Umgebung)' }
    return { level: 'ok', label: 'Alle Systeme betriebsbereit' }
  })

  async function refresh(): Promise<void> {
    refreshing.value = true
    try {
      data.value = await adminApi.health()
      lastSuccessAt.value = new Date()
      lastTickFailed.value = false
    } catch {
      // Keep last-known values; flag the tick as failed so the UI can mark
      // the display stale rather than silently freezing the timestamp.
      lastTickFailed.value = true
    } finally {
      refreshing.value = false
    }
  }

  return { checks, sortedChecks, overall, loading, isStale, refreshing, lastSuccessAt, refresh }
}
