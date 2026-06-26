<template>
  <div class="max-w-4xl">
    <h1 class="text-2xl font-semibold mb-4">Ankündigungen</h1>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

    <!-- create / edit form -->
    <div class="bg-white rounded-lg shadow-sm p-4 space-y-4 mb-6">
      <div class="flex items-center justify-between">
        <h2 class="font-medium">{{ editingId ? 'Ankündigung bearbeiten' : 'Neue Ankündigung' }}</h2>
        <button v-if="editingId" class="text-sm text-slate-500 hover:underline" @click="resetForm">Abbrechen</button>
      </div>

      <div class="flex flex-wrap gap-4 items-end">
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-slate-500">Stufe</span>
          <select v-model="form.level" class="border border-slate-300 rounded px-2 py-2 text-sm">
            <option value="ERROR">{{ LEVEL_META.ERROR.icon }} Störung</option>
            <option value="INFO">{{ LEVEL_META.INFO.icon }} Info</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-slate-500">Standardsprache</span>
          <select v-model="form.defaultLocale" class="border border-slate-300 rounded px-2 py-2 text-sm">
            <option v-for="l in LOCALES" :key="l" :value="l">{{ LOCALE_NAMES[l] }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1.5 text-sm pb-2">
          <input v-model="form.dismissible" type="checkbox" /> Schließbar
        </label>
        <label class="flex items-center gap-1.5 text-sm pb-2">
          <input v-model="form.public" type="checkbox" /> Öffentlich (vor Login)
        </label>
        <label class="flex items-center gap-1.5 text-sm pb-2">
          <input v-model="form.active" type="checkbox" /> Sofort aktiv
        </label>
      </div>

      <fieldset class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label v-for="l in LOCALES" :key="l" class="flex flex-col gap-1 text-sm">
          <span class="text-slate-500">
            Nachricht ({{ LOCALE_NAMES[l] }})
            <span v-if="l === form.defaultLocale" class="text-slate-400">– Pflicht</span>
          </span>
          <textarea
            v-model="form.messages[l]"
            rows="2"
            maxlength="500"
            class="border border-slate-300 rounded px-3 py-2 text-sm"
            :class="l === form.defaultLocale && !form.messages[l].trim() ? 'border-red-400' : ''"
          />
        </label>
      </fieldset>

      <div class="flex flex-wrap gap-4 items-end">
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-slate-500">Start (optional)</span>
          <input v-model="form.startsAt" type="datetime-local" class="border border-slate-300 rounded px-2 py-1.5" />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-slate-500">Ende (optional)</span>
          <input v-model="form.endsAt" type="datetime-local" class="border border-slate-300 rounded px-2 py-1.5" />
        </label>
        <button
          class="ml-auto self-end rounded bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-700 disabled:opacity-50"
          :disabled="saving || !defaultMessageFilled"
          @click="submit"
        >
          {{ editingId ? 'Speichern' : 'Anlegen' }}
        </button>
      </div>

      <!-- live preview: mirrors the mobile banner so authoring is not blind -->
      <div>
        <p class="text-xs text-slate-400 mb-1">Vorschau ({{ LOCALE_NAMES[form.defaultLocale] }})</p>
        <div
          class="flex items-center gap-2 rounded px-3 py-2 text-sm"
          :style="{ background: LEVEL_META[form.level].bg, color: LEVEL_META[form.level].fg }"
        >
          <span>{{ LEVEL_META[form.level].icon }}</span>
          <span class="font-bold uppercase text-[11px] tracking-wide">{{ form.level === 'ERROR' ? 'Störung' : 'Info' }}</span>
          <span class="flex-1">{{ form.messages[form.defaultLocale] || 'Nachricht …' }}</span>
          <span v-if="form.dismissible">✕</span>
        </div>
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
          <tr v-if="loading">
            <td class="px-4 py-6 text-center text-slate-400" colspan="5">Lädt …</td>
          </tr>
          <tr v-for="a in data?.announcements ?? []" :key="a.id" class="border-t border-slate-100">
            <td class="px-4 py-2">
              <span class="text-xs rounded px-1" :class="levelClass(a.level)">{{ LEVEL_META[a.level].icon }} {{ levelLabel(a.level) }}</span>
            </td>
            <td class="px-4 py-2">{{ rowMessage(a) }}</td>
            <td class="px-4 py-2 text-slate-500 whitespace-nowrap">{{ rangeLabel(a) }}</td>
            <td class="px-4 py-2">
              <span class="text-xs rounded px-1" :class="statusOf(a).cls">{{ statusOf(a).label }}</span>
            </td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button class="text-slate-700 hover:underline mr-3" @click="edit(a)">Bearbeiten</button>
              <button class="text-slate-700 hover:underline mr-3" @click="toggleActive(a)">
                {{ a.active ? 'Deaktivieren' : 'Aktivieren' }}
              </button>
              <button class="text-red-600 hover:underline" @click="remove(a.id)">Löschen</button>
            </td>
          </tr>
          <tr v-if="!loading && data && data.announcements.length === 0">
            <td class="px-4 py-6 text-center text-slate-400" colspan="5">Noch keine Ankündigungen</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  ANNOUNCEMENT_LOCALES,
  ANNOUNCEMENT_LEVEL_STYLE,
  type AdminAnnouncementDto,
  type AdminAnnouncementListDto,
  type AnnouncementLevel,
  type AnnouncementLocale,
} from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { date } from '../format'

const LOCALES = ANNOUNCEMENT_LOCALES
const LEVEL_META = ANNOUNCEMENT_LEVEL_STYLE
const LOCALE_NAMES: Record<AnnouncementLocale, string> = {
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
  pl: 'Polski',
  cs: 'Čeština',
  ru: 'Русский',
}

const data = ref<AdminAnnouncementListDto | null>(null)
const error = ref('')
const saving = ref(false)
const loading = ref(true)
const editingId = ref<string | null>(null)

function emptyMessages(): Record<AnnouncementLocale, string> {
  return { de: '', en: '', fr: '', pl: '', cs: '', ru: '' }
}

const form = reactive({
  level: 'INFO' as AnnouncementLevel,
  messages: emptyMessages(),
  defaultLocale: 'de' as AnnouncementLocale,
  dismissible: true,
  public: false,
  active: true,
  startsAt: '',
  endsAt: '',
})

const defaultMessageFilled = computed(() => form.messages[form.defaultLocale].trim().length > 0)

function levelLabel(l: string): string {
  return l === 'ERROR' ? 'Störung' : 'Info'
}
function levelClass(l: string): string {
  return l === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'
}
function rowMessage(a: AdminAnnouncementDto): string {
  return a.messages[a.defaultLocale] ?? Object.values(a.messages)[0] ?? ''
}
function rangeLabel(a: AdminAnnouncementDto): string {
  if (!a.startsAt && !a.endsAt) return 'immer'
  return `${a.startsAt ? date(a.startsAt) : '—'} … ${a.endsAt ? date(a.endsAt) : '—'}`
}
// Real visibility, not the raw active flag.
function statusOf(a: AdminAnnouncementDto): { label: string; cls: string } {
  if (!a.active) return { label: 'Inaktiv', cls: 'bg-slate-100 text-slate-500' }
  const now = Date.now()
  if (a.startsAt && new Date(a.startsAt).getTime() > now) return { label: 'Geplant', cls: 'bg-sky-100 text-sky-700' }
  if (a.endsAt && new Date(a.endsAt).getTime() < now) return { label: 'Abgelaufen', cls: 'bg-slate-100 text-slate-500' }
  return { label: 'LIVE', cls: 'bg-emerald-100 text-emerald-700' }
}

// datetime-local has no timezone; interpret as local, send UTC ISO.
function toIso(local: string): string | undefined {
  return local ? new Date(local).toISOString() : undefined
}
// ISO → value for <input type="datetime-local"> (local time, no seconds).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function buildMessages(): Partial<Record<AnnouncementLocale, string>> {
  const out: Partial<Record<AnnouncementLocale, string>> = {}
  for (const l of LOCALES) {
    const v = form.messages[l].trim()
    if (v) out[l] = v
  }
  return out
}

function resetForm(): void {
  editingId.value = null
  form.level = 'INFO'
  form.messages = emptyMessages()
  form.defaultLocale = 'de'
  form.dismissible = true
  form.public = false
  form.active = true
  form.startsAt = ''
  form.endsAt = ''
}

async function reload(): Promise<void> {
  error.value = ''
  loading.value = true
  try {
    data.value = await adminApi.announcements()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Laden fehlgeschlagen'
  } finally {
    loading.value = false
  }
}

async function submit(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    const messages = buildMessages()
    if (editingId.value) {
      // Edit: send explicit null to clear a previously-set window bound.
      await adminApi.updateAnnouncement(editingId.value, {
        level: form.level,
        messages,
        defaultLocale: form.defaultLocale,
        dismissible: form.dismissible,
        public: form.public,
        active: form.active,
        startsAt: form.startsAt ? toIso(form.startsAt) : null,
        endsAt: form.endsAt ? toIso(form.endsAt) : null,
      })
    } else {
      await adminApi.createAnnouncement({
        level: form.level,
        messages,
        defaultLocale: form.defaultLocale,
        dismissible: form.dismissible,
        public: form.public,
        active: form.active,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
      })
    }
    resetForm()
    await reload()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'
  } finally {
    saving.value = false
  }
}

function edit(a: AdminAnnouncementDto): void {
  editingId.value = a.id
  form.level = a.level
  form.messages = { ...emptyMessages(), ...a.messages }
  form.defaultLocale = a.defaultLocale
  form.dismissible = a.dismissible
  form.public = a.public
  form.active = a.active
  form.startsAt = isoToLocalInput(a.startsAt)
  form.endsAt = isoToLocalInput(a.endsAt)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function toggleActive(a: AdminAnnouncementDto): Promise<void> {
  error.value = ''
  try {
    await adminApi.updateAnnouncement(a.id, { active: !a.active })
    await reload()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Aktualisieren fehlgeschlagen'
  }
}

async function remove(id: string): Promise<void> {
  if (!confirm('Ankündigung wirklich löschen?')) return
  error.value = ''
  try {
    await adminApi.deleteAnnouncement(id)
    await reload()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'
  }
}

onMounted(reload)
</script>
