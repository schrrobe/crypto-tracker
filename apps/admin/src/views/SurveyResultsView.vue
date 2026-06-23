<template>
  <div class="max-w-4xl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">{{ results?.title ?? 'Auswertung' }}</h1>
      <button class="text-slate-600 text-sm hover:underline" @click="$router.push('/surveys')">← Zurück</button>
    </div>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>
    <p class="text-slate-500 text-sm mb-4">{{ results?.responseCount ?? 0 }} Antworten</p>

    <div v-for="q in results?.questions ?? []" :key="q.questionId" class="bg-white rounded-lg shadow-sm p-4 mb-4">
      <h3 class="text-sm font-medium text-slate-700 mb-3">{{ q.prompt }}</h3>

      <!-- choice questions: table + bar chart -->
      <template v-if="q.type !== 'FREE_TEXT'">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <table class="w-full text-sm">
            <thead class="text-left text-slate-500">
              <tr><th class="py-1">Option</th><th class="py-1">Anzahl</th></tr>
            </thead>
            <tbody>
              <tr v-for="o in q.options" :key="o.optionId" class="border-t border-slate-100">
                <td class="py-1">{{ o.label }}</td>
                <td class="py-1">{{ o.count }}</td>
              </tr>
            </tbody>
          </table>
          <Bar :data="chartData(q)" :options="opts" />
        </div>
      </template>

      <!-- free-text: searchable paginated list + CSV export -->
      <template v-else>
        <div class="flex gap-2 mb-3">
          <input
            v-model="ft(q.questionId).q"
            placeholder="Suchen…"
            class="border border-slate-300 rounded px-3 py-1.5 text-sm"
            @keyup.enter="loadFreeText(q.questionId, 1)"
          />
          <button class="rounded border border-slate-300 text-sm px-3 py-1.5 hover:bg-slate-50" @click="loadFreeText(q.questionId, 1)">
            Suchen
          </button>
          <button class="rounded border border-slate-300 text-sm px-3 py-1.5 hover:bg-slate-50" @click="exportCsv(q.questionId)">
            CSV ⬇
          </button>
          <span class="text-slate-400 text-sm self-center ml-auto">{{ q.freeTextCount }} gesamt</span>
        </div>
        <ul class="text-sm divide-y divide-slate-100">
          <li v-for="(a, i) in ft(q.questionId).answers" :key="i" class="py-2">
            <span class="text-slate-800">{{ a.text }}</span>
            <span class="text-slate-400 text-xs ml-2">{{ a.userId.slice(0, 8) }}</span>
          </li>
          <li v-if="ft(q.questionId).loaded && ft(q.questionId).answers.length === 0" class="py-2 text-slate-400">
            Keine Antworten
          </li>
        </ul>
        <div v-if="ft(q.questionId).total > pageSize" class="flex gap-2 items-center mt-3 text-sm">
          <button class="px-2 py-1 disabled:opacity-40" :disabled="ft(q.questionId).page <= 1" @click="loadFreeText(q.questionId, ft(q.questionId).page - 1)">‹</button>
          <span>{{ ft(q.questionId).page }} / {{ pageCount(q.questionId) }}</span>
          <button class="px-2 py-1 disabled:opacity-40" :disabled="ft(q.questionId).page >= pageCount(q.questionId)" @click="loadFreeText(q.questionId, ft(q.questionId).page + 1)">›</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Bar } from 'vue-chartjs'
import type { FreeTextAnswerDto, SurveyQuestionResultDto, SurveyResultsDto } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'

const route = useRoute()
const id = route.params.id as string
const pageSize = 25

const results = ref<SurveyResultsDto | null>(null)
const error = ref('')
const opts = { responsive: true, plugins: { legend: { display: false } } }

interface FtState {
  q: string
  page: number
  total: number
  answers: FreeTextAnswerDto[]
  loaded: boolean
}
const ftState = reactive<Record<string, FtState>>({})

// Lazily create per-question free-text state (template renders before onMounted populates).
function ft(qid: string): FtState {
  if (!ftState[qid]) ftState[qid] = { q: '', page: 1, total: 0, answers: [], loaded: false }
  return ftState[qid] as FtState
}

function chartData(q: SurveyQuestionResultDto) {
  return {
    labels: q.options.map((o) => o.label),
    datasets: [{ label: 'Antworten', data: q.options.map((o) => o.count), backgroundColor: '#334155' }],
  }
}

function pageCount(qid: string): number {
  return Math.max(1, Math.ceil(ft(qid).total / pageSize))
}

async function loadFreeText(qid: string, page: number) {
  const st = ft(qid)
  const res = await adminApi.surveyFreeText(id, { questionId: qid, q: st.q || undefined, page, pageSize })
  st.answers = res.answers
  st.total = res.total
  st.page = res.page
  st.loaded = true
}

async function exportCsv(qid: string) {
  await adminApi.surveyFreeTextCsv(id, qid)
}

onMounted(async () => {
  try {
    results.value = await adminApi.surveyResults(id)
    for (const q of results.value.questions) {
      if (q.type === 'FREE_TEXT') {
        await loadFreeText(q.questionId, 1)
      }
    }
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Laden fehlgeschlagen'
  }
})
</script>
