import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { AnnouncementDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'
import { getStored, setStored } from '../services/storage'

const STORAGE_KEY = 'dismissed-announcements'

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

  // Active announcements the user has not dismissed on this device.
  const visible = computed(() => active.value.filter((a) => !dismissed.value.includes(a.id)))

  async function loadActive(): Promise<void> {
    active.value = (await api.get<{ announcements: AnnouncementDto[] }>('/announcements/active')).announcements
  }

  function dismiss(id: string): void {
    if (dismissed.value.includes(id)) return
    dismissed.value = [...dismissed.value, id]
    setStored(STORAGE_KEY, JSON.stringify(dismissed.value))
  }

  // Clear fetched data on logout; keep dismissed ids (they are per-device).
  function reset(): void {
    active.value = []
  }

  return { active, dismissed, visible, loadActive, dismiss, reset }
})
