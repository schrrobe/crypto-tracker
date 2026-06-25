<template>
  <div class="max-w-4xl">
    <h1 class="text-2xl font-semibold mb-4">Ankündigungen</h1>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

    <!-- create form -->
    <div class="bg-white rounded-lg shadow-sm p-4 space-y-3 mb-6">
      <div class="flex gap-2">
        <select v-model="form.level" class="border border-slate-300 rounded px-2 py-2 text-sm">
          <option value="ERROR">Fehler (rot)</option>
          <option value="INFO">Info (gelb)</option>
        </select>
        <input
          v-model="form.message"
          placeholder="Nachricht"
          class="flex-1 border border-slate-300 rounded px-3 py-2 text-sm"
        />
      </div>
      <div class="flex gap-4 items-center text-sm">
        <label class="flex flex-col gap-1">
          <span class="text-slate-500">Start (optional)</span>
          <input v-model="form.startsAt" type="datetime-local" class="border border-slate-300 rounded px-2 py-1.5" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-slate-500">Ende (optional)</span>
          <input v-model="form.endsAt" type="datetime-local" class="border border-slate-300 rounded px-2 py-1.5" />
        </label>
        <label class="flex items-center gap-1 self-end pb-1.5">
          <input v-model="form.active" type="checkbox" /> Sofort aktiv
        </label>
        <button
          class="ml-auto self-end rounded bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-700 disabled:opacity-50"
          :disabled="saving || !form.message.trim()"
          @click="create"
        >
          Anlegen
        </button>
      </div>
    </div>

    <!-- list -->
    <div class="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500">
          <tr>
            <th class="px-4 py-2">Typ</th>
            <th class="px-4 py-2">Nachricht</th>
            <th class="px-4 py-2">Zeitraum</th>
            <th class="px-4 py-2">Status</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in data?.announcements ?? []" :key="a.id" class="border-t border-slate-100">
            <td class="px-4 py-2">
              <span class="text-xs rounded px-1" :class="levelClass(a.level)">{{ levelLabel(a.level) }}</span>
            </td>
            <td class="px-4 py-2">{{ a.message }}</td>
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">
              {{ a.startsAt ? date(a.startsAt) : '—' }} … {{ a.endsAt ? date(a.endsAt) : '—' }}
            </td>
            <td class="px-4 py-2">
              <span class="text-xs rounded px-1" :class="a.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'">
                {{ a.active ? 'aktiv' : 'inaktiv' }}
              </span>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button class="text-slate-700 hover:underline mr-3" @click="toggleActive(a)">
                {{ a.active ? 'Deaktivieren' : 'Aktivieren' }}
              </button>
              <button class="text-red-600 hover:underline" @click="remove(a.id)">Löschen</button>
            </td>
          </tr>
          <tr v-if="data && data.announcements.length === 0">
            <td class="px-4 py-6 text-center text-slate-400" colspan="5">Noch keine Ankündigungen</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { AdminAnnouncementDto, AdminAnnouncementListDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { date } from '../format'

const data = ref<AdminAnnouncementListDto | null>(null)
const error = ref('')
const saving = ref(false)

const form = reactive({
  level: 'INFO' as 'ERROR' | 'INFO',
  message: '',
  startsAt: '',
  endsAt: '',
  active: true,
})

function levelLabel(l: string): string {
  return l === 'ERROR' ? 'Fehler' : 'Info'
}
function levelClass(l: string): string {
  return l === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
}

// datetime-local has no timezone; interpret as local time and send UTC ISO.
function toIso(local: string): string | undefined {
  return local ? new Date(local).toISOString() : undefined
}

async function reload() {
  error.value = ''
  try {
    data.value = await adminApi.announcements()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Laden fehlgeschlagen'
  }
}

async function create() {
  error.value = ''
  saving.value = true
  try {
    await adminApi.createAnnouncement({
      level: form.level,
      message: form.message.trim(),
      active: form.active,
      startsAt: toIso(form.startsAt),
      endsAt: toIso(form.endsAt),
    })
    form.message = ''
    form.startsAt = ''
    form.endsAt = ''
    await reload()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'
  } finally {
    saving.value = false
  }
}

async function toggleActive(a: AdminAnnouncementDto) {
  await adminApi.updateAnnouncement(a.id, { active: !a.active })
  await reload()
}

async function remove(id: string) {
  if (!confirm('Ankündigung wirklich löschen?')) return
  await adminApi.deleteAnnouncement(id)
  await reload()
}

onMounted(reload)
</script>
