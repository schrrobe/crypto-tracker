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

  // Single-flight guard: interval + resume + visibilitychange + watch(immediate)
  // can all fire near-simultaneously; collapse overlapping loads into one request.
  let inFlight: Promise<void> | null = null

  // Drop dismissed keys that no longer match any active announcement's current
  // key (announcement deleted, or edited so its key changed). Prevents the
  // localStorage list from growing without bound.
  function pruneDismissed(): void {
    const live = new Set(active.value.map(keyOf))
    const kept = dismissed.value.filter((k) => live.has(k))
    if (kept.length !== dismissed.value.length) {
      dismissed.value = kept
      setStored(STORAGE_KEY, JSON.stringify(kept))
    }
  }

  function run(fetcher: () => Promise<AnnouncementDto[]>): Promise<void> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      active.value = await fetcher()
      pruneDismissed()
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  // Authed: all active announcements.
  function loadActive(): Promise<void> {
    return run(async () => (await api.get<{ announcements: AnnouncementDto[] }>('/announcements/active')).announcements)
  }

  // Pre-login: public announcements only. Plain fetch, NO bearer / NO 401-refresh
  // pipeline (a missing session must not trigger a refresh). Fails closed.
  function loadPublic(): Promise<void> {
    return run(async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/announcements/public`)
        if (!res.ok) return []
        return ((await res.json()) as { announcements: AnnouncementDto[] }).announcements
      } catch {
        return []
      }
    })
  }

  function dismiss(a: AnnouncementDto): void {
    const k = keyOf(a)
    if (dismissed.value.includes(k)) return
    dismissed.value = [...dismissed.value, k]
    setStored(STORAGE_KEY, JSON.stringify(dismissed.value))
  }

  // Clear fetched data on logout; keep dismissed ids (they are per-device).
  function reset(): void {
    active.value = []
  }

  return { active, dismissed, visible, loadActive, loadPublic, dismiss, reset }
})
