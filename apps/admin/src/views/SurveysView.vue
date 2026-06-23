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

    <div class="bg-white rounded-lg shadow-sm overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-50 text-left text-slate-500">
          <tr>
            <th class="px-4 py-2">Titel</th>
            <th class="px-4 py-2">Status</th>
            <th class="px-4 py-2">Fragen</th>
            <th class="px-4 py-2">Antworten</th>
            <th class="px-4 py-2">Erstellt</th>
            <th class="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in data?.surveys ?? []"
            :key="s.id"
            class="border-t border-slate-100 hover:bg-slate-50"
          >
            <td class="px-4 py-2 font-medium">{{ s.title }}</td>
            <td class="px-4 py-2">
              <span class="text-xs rounded px-1" :class="statusClass(s.status)">{{ statusLabel(s.status) }}</span>
            </td>
            <td class="px-4 py-2">{{ s.questionCount }}</td>
            <td class="px-4 py-2">{{ s.responseCount }}</td>
            <td class="px-4 py-2 text-slate-500">{{ date(s.createdAt) }}</td>
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <button
                v-if="s.status === 'DRAFT'"
                class="text-emerald-700 hover:underline mr-3"
                @click="publish(s.id)"
              >
                Veröffentlichen
              </button>
              <button
                v-if="s.status === 'PUBLISHED'"
                class="text-amber-700 hover:underline mr-3"
                @click="close(s.id)"
              >
                Schließen
              </button>
              <button class="text-slate-700 hover:underline mr-3" @click="$router.push(`/surveys/${s.id}/results`)">
                Auswerten
              </button>
              <button class="text-red-600 hover:underline" @click="remove(s.id)">Löschen</button>
            </td>
          </tr>
          <tr v-if="data && data.surveys.length === 0">
            <td class="px-4 py-6 text-center text-slate-400" colspan="6">Noch keine Umfragen</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SurveyListDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'
import { date } from '../format'

const data = ref<SurveyListDto | null>(null)
const error = ref('')

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
      CLOSED: 'bg-amber-100 text-amber-700',
    }[s] ?? 'bg-slate-100 text-slate-600'
  )
}

async function publish(id: string) {
  await adminApi.publishSurvey(id)
  await reload()
}
async function close(id: string) {
  await adminApi.closeSurvey(id)
  await reload()
}
async function remove(id: string) {
  if (!confirm('Umfrage wirklich löschen? Alle Antworten gehen verloren.')) return
  await adminApi.deleteSurvey(id)
  await reload()
}

onMounted(reload)
</script>
