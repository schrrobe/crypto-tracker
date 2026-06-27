<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">Umfragen</h1>
      <button
        class="rounded bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-700"
        @click="$router.push('/surveys/new')"
      >
        Neue Umfrage
      </button>
    </div>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

    <!-- Loading skeleton -->
    <div v-if="data === null" class="bg-white rounded-lg shadow-sm p-4 space-y-3">
      <div v-for="n in 3" :key="n" class="h-6 bg-slate-100 rounded animate-pulse" />
    </div>

    <div v-else class="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500">
          <tr>
            <th class="px-4 py-2">Titel</th>
            <th class="px-4 py-2">Status</th>
            <th class="px-4 py-2">Zielgruppe</th>
            <th class="px-4 py-2">Fragen</th>
            <th class="px-4 py-2">Rücklauf</th>
            <th class="px-4 py-2">Erstellt</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in data.surveys"
            :key="s.id"
            class="border-t border-slate-100 hover:bg-slate-50"
          >
            <td class="px-4 py-2 font-medium">
              {{ s.title }}
              <span
                v-if="s.anonymous"
                class="text-xs rounded px-1.5 py-0.5 ml-1 bg-violet-100 text-violet-700"
                >anonym</span
              >
            </td>
            <td class="px-4 py-2">
              <span class="text-xs rounded px-1" :class="statusClass(s.status)">{{ statusLabel(s.status) }}</span>
            </td>
            <td class="px-4 py-2 text-slate-500 text-xs">{{ targetingSummary(s) }}</td>
            <td class="px-4 py-2">{{ s.questionCount }}</td>
            <td class="px-4 py-2 text-slate-600 tabular-nums">{{ responseRate(s) }}</td>
            <td class="px-4 py-2 text-slate-500">{{ date(s.createdAt) }}</td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <div class="flex items-center justify-end gap-3">
                <!-- Primary action: Veröffentlichen for DRAFT, otherwise Auswerten -->
                <button
                  v-if="s.status === 'DRAFT'"
                  class="rounded bg-emerald-600 text-white text-xs px-2.5 py-1 hover:bg-emerald-700"
                  @click="askPublish(s)"
                >
                  Veröffentlichen
                </button>
                <button
                  v-else
                  class="rounded bg-slate-900 text-white text-xs px-2.5 py-1 hover:bg-slate-700"
                  @click="$router.push(`/surveys/${s.id}/results`)"
                >
                  Auswerten
                </button>

                <!-- Secondary actions -->
                <button
                  v-if="s.status === 'DRAFT'"
                  class="text-slate-600 hover:underline"
                  @click="$router.push(`/surveys/${s.id}/edit`)"
                >
                  Bearbeiten
                </button>
                <button
                  v-if="s.status === 'PUBLISHED'"
                  class="text-blue-700 hover:underline"
                  @click="askClose(s)"
                >
                  Schließen
                </button>
                <button
                  v-if="s.status === 'PUBLISHED' && hasNonResponders(s)"
                  class="text-blue-700 hover:underline disabled:opacity-50"
                  :disabled="reminding === s.id"
                  @click="remind(s.id)"
                >
                  {{ reminding === s.id ? 'Erinnere…' : 'Nicht-Antwortende erinnern' }}
                </button>

                <!-- Demoted destructive action -->
                <button class="text-xs text-slate-400 hover:text-red-600" @click="askDelete(s)">Löschen</button>
              </div>
              <p v-if="reminderMsg[s.id]" class="text-xs text-slate-500 mt-1 text-right">{{ reminderMsg[s.id] }}</p>
            </td>
          </tr>
          <tr v-if="data.surveys.length === 0">
            <td class="px-4 py-6 text-center text-slate-400" colspan="7">Noch keine Umfragen</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Publish confirm with pre-publish summary -->
    <ConfirmDialog
      v-if="publishTarget"
      title="Umfrage veröffentlichen?"
      confirm-label="Veröffentlichen"
      @cancel="publishTarget = null"
      @confirm="confirmPublish"
    >
      <ul class="space-y-1 mb-3">
        <li><span class="text-slate-400">Titel:</span> {{ publishTarget.title }}</li>
        <li><span class="text-slate-400">Anonym:</span> {{ publishTarget.anonymous ? 'Ja' : 'Nein' }}</li>
        <li>Erreicht ~{{ publishTarget.eligibleCount }} Nutzer</li>
        <li><span class="text-slate-400">Fragen:</span> {{ publishTarget.questionCount }}</li>
      </ul>
      <p class="text-amber-700">Kann danach nicht mehr bearbeitet werden und wird für die Nutzer sichtbar.</p>
    </ConfirmDialog>

    <!-- Close confirm -->
    <ConfirmDialog
      v-if="closeTarget"
      title="Umfrage schließen?"
      confirm-label="Schließen"
      message="Umfrage schließen? Nutzer können dann nicht mehr antworten. Das lässt sich nicht rückgängig machen."
      @cancel="closeTarget = null"
      @confirm="confirmClose"
    />

    <!-- Delete confirm -->
    <ConfirmDialog
      v-if="deleteTarget"
      title="Umfrage löschen?"
      confirm-label="Löschen"
      :danger="true"
      message="Umfrage wirklich löschen? Alle Antworten gehen verloren."
      @cancel="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { SurveyListDto, SurveyListItemDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { date } from '../format'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const data = ref<SurveyListDto | null>(null)
const error = ref('')
const reminding = ref<string | null>(null)
const reminderMsg = reactive<Record<string, string>>({})

const publishTarget = ref<SurveyListItemDto | null>(null)
const closeTarget = ref<SurveyListItemDto | null>(null)
const deleteTarget = ref<SurveyListItemDto | null>(null)

function targetingSummary(s: SurveyListItemDto): string {
  const parts: string[] = []
  if (s.targetPlans.length) parts.push(s.targetPlans.join('/'))
  if (s.targetCurrencies.length) parts.push(s.targetCurrencies.join(', '))
  const scope = parts.length ? parts.join(' · ') : 'Alle'
  return `${scope} (${s.eligibleCount})`
}

function responseRate(s: SurveyListItemDto): string {
  // Clamp: eligibleCount is recomputed live while responseCount is historical, so a
  // responder who later left the segment (plan/currency change, suspension) can push
  // the ratio over 100%. Show the larger of the two as the denominator so it never
  // renders e.g. "150% · 3/2".
  const denom = Math.max(s.eligibleCount, s.responseCount)
  const pct = denom > 0 ? Math.round((s.responseCount / denom) * 100) : 0
  return `${pct}% · ${s.responseCount}/${denom}`
}

function hasNonResponders(s: SurveyListItemDto): boolean {
  return s.responseCount < s.eligibleCount
}

async function remind(id: string) {
  reminding.value = id
  delete reminderMsg[id]
  try {
    const res = await adminApi.remindSurvey(id)
    reminderMsg[id] = res.skippedCooldown
      ? 'Kürzlich erinnert – Cooldown aktiv'
      : `${res.notified} erinnert (${res.alreadyResponded} bereits geantwortet)`
  } catch (e) {
    reminderMsg[id] = e instanceof ApiError ? e.message : 'Erinnern fehlgeschlagen'
  } finally {
    reminding.value = null
  }
}

async function reload() {
  error.value = ''
  try {
    data.value = await adminApi.surveys()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Laden fehlgeschlagen'
  }
}

function statusLabel(s: string): string {
  return { DRAFT: 'Entwurf', PUBLISHED: 'Veröffentlicht', CLOSED: 'Geschlossen' }[s] ?? s
}
function statusClass(s: string): string {
  return (
    {
      DRAFT: 'bg-slate-100 text-slate-600',
      PUBLISHED: 'bg-emerald-100 text-emerald-700',
      CLOSED: 'bg-blue-100 text-blue-700',
    }[s] ?? 'bg-slate-100 text-slate-600'
  )
}

function askPublish(s: SurveyListItemDto) {
  publishTarget.value = s
}
function askClose(s: SurveyListItemDto) {
  closeTarget.value = s
}
function askDelete(s: SurveyListItemDto) {
  deleteTarget.value = s
}

async function confirmPublish() {
  const id = publishTarget.value?.id
  publishTarget.value = null
  if (!id) return
  await adminApi.publishSurvey(id)
  await reload()
}
async function confirmClose() {
  const id = closeTarget.value?.id
  closeTarget.value = null
  if (!id) return
  await adminApi.closeSurvey(id)
  await reload()
}
async function confirmDelete() {
  const id = deleteTarget.value?.id
  deleteTarget.value = null
  if (!id) return
  await adminApi.deleteSurvey(id)
  await reload()
}

onMounted(reload)
</script>
