import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AnnouncementDto } from '@crypto-tracker/shared'
import { api, apiBaseUrl } from '../services/api.client'
import { getStored, setStored } from '../services/storage'

const STORAGE_KEY = 'dismissed-announcements'

// Dismiss is keyed by id + updatedAt so editing an announcement (which bumps
// updatedAt) produces a new key and re-surfaces the banner to users who
// dismissed the previous version.
function keyOf(a: AnnouncementDto): string {
  return `${a.id}:${a.updatedAt}`
}

function loadDismissed(): string[] {
  try {
    const raw = getStored(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export const useAnnouncementsStore = defineStore('announcements', () => {
  const active = ref<AnnouncementDto[]>([])
  const dismissed = ref<string[]>(loadDismissed())

  // Active announcements the user has not dismissed (by id:updatedAt) on this device.
  const visible = computed(() => active.value.filter((a) => !dismissed.value.includes(keyOf(a))))

  // Single-flight guard, per-kind. interval + resume + visibilitychange +
  // watch(immediate) can fire near-simultaneously; collapse overlapping loads of
  // the SAME kind into one request. The two kinds ('active' authed / 'public'
  // pre-login) get independent slots so an auth transition starts a fresh fetch
  // without colliding. A request-sequence number discards a resolved result that
  // a later call (or reset/logout) superseded — so an in-flight authed fetch
  // can't land non-public announcements after logout.
  type LoadKind = 'active' | 'public'
  const inFlight: Partial<Record<LoadKind, Promise<void>>> = {}
  let requestSeq = 0

  // Drop dismissed keys that no longer match any active announcement's current
  // key (announcement deleted, or edited so its key changed). Prevents the
  // localStorage list from growing without bound. Only runs after an AUTHED load
  // — the public subset is partial, so pruning against it would wrongly delete
  // dismissals for non-public announcements.
  function pruneDismissed(): void {
    const live = new Set(active.value.map(keyOf))
    const kept = dismissed.value.filter((k) => live.has(k))
    if (kept.length !== dismissed.value.length) {
      dismissed.value = kept
      setStored(STORAGE_KEY, JSON.stringify(kept))
    }
  }

  function run(kind: LoadKind, fetcher: () => Promise<AnnouncementDto[]>, prune: boolean): Promise<void> {
    if (inFlight[kind]) return inFlight[kind]!
    const seq = ++requestSeq
    const tracked: Promise<void> = (async () => {
      const next = await fetcher()
      if (seq !== requestSeq) return // superseded by a later load or reset()
      active.value = next
      if (prune) pruneDismissed()
    })().finally(() => {
      // Only clear the slot if THIS promise still owns it (a newer same-kind
      // request may have replaced it).
      if (inFlight[kind] === tracked) delete inFlight[kind]
    })
    inFlight[kind] = tracked
    return tracked
  }

  // Authed: all active announcements. Prunes dismissals against the full set.
  function loadActive(): Promise<void> {
    return run(
      'active',
      async () => (await api.get<{ announcements: AnnouncementDto[] }>('/announcements/active')).announcements,
      true,
    )
  }

  // Pre-login: public announcements only. Plain fetch, NO bearer / NO 401-refresh
  // pipeline (a missing session must not trigger a refresh). Fails closed. Does
  // NOT prune — the public subset can't see private dismissals.
  function loadPublic(): Promise<void> {
    return run(
      'public',
      async () => {
        try {
          const res = await fetch(`${apiBaseUrl()}/announcements/public`)
          if (!res.ok) return []
          return ((await res.json()) as { announcements: AnnouncementDto[] }).announcements
        } catch {
          return []
        }
      },
      false,
    )
  }

  function dismiss(a: AnnouncementDto): void {
    const k = keyOf(a)
    if (dismissed.value.includes(k)) return
    dismissed.value = [...dismissed.value, k]
    setStored(STORAGE_KEY, JSON.stringify(dismissed.value))
  }

  // Clear fetched data on logout; keep dismissed ids (they are per-device).
  // Bump the sequence so any in-flight authed fetch is discarded on resolve.
  function reset(): void {
    requestSeq++
    active.value = []
  }

  return { active, dismissed, visible, loadActive, loadPublic, dismiss, reset }
})
