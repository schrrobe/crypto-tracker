<template>
  <div class="max-w-4xl">
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">{{ results?.title ?? 'Auswertung' }}</h1>
      <button class="text-slate-600 text-sm hover:underline" @click="$router.push('/surveys')">← Zurück</button>
    </div>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

    <!-- Loading skeleton -->
    <div v-if="results === null && !error" class="space-y-4">
      <div class="h-6 w-1/3 bg-slate-100 rounded animate-pulse" />
      <div v-for="n in 2" :key="n" class="bg-white rounded-lg shadow-sm p-4">
        <div class="h-24 bg-slate-100 rounded animate-pulse" />
      </div>
    </div>

    <template v-else-if="results">
      <div
        v-if="results.eligibleCount === 0"
        class="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3 mb-4"
      >
        Diese Umfrage erreicht aktuell niemanden (Zielgruppe leer).
      </div>

      <div class="flex items-center gap-3 text-sm mb-4">
        <span class="text-slate-700 font-medium">{{ responseRatePct }}% Rücklaufquote</span>
        <span class="text-slate-500">{{ results.responseCount }} / {{ results.eligibleCount }} Antworten</span>
        <span v-if="results.anonymous" class="text-xs rounded px-1.5 py-0.5 bg-violet-100 text-violet-700">anonym</span>
      </div>

      <div v-for="q in results.questions" :key="q.questionId" class="bg-white rounded-lg shadow-sm p-4 mb-4">
        <h3 class="text-sm font-medium text-slate-700 mb-1">{{ q.prompt }}</h3>
        <p class="text-xs text-slate-400 mb-3">beantwortet von {{ q.answeredCount }} von {{ results.responseCount }}</p>

        <!-- choice questions: table + horizontal bar chart -->
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

        <!-- free-text: collapsed behind a toggle; answers load on expand -->
        <template v-else>
          <button
            class="rounded border border-slate-300 text-sm px-3 py-1.5 hover:bg-slate-50"
            @click="toggleFreeText(q.questionId)"
          >
            {{ ft(q.questionId).expanded ? 'Antworten verbergen' : `Antworten anzeigen (${q.freeTextCount})` }}
          </button>

          <div v-if="ft(q.questionId).expanded" class="mt-3">
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
            <p v-if="ft(q.questionId).csvMsg" class="text-xs text-emerald-600 mb-2">{{ ft(q.questionId).csvMsg }}</p>
            <ul class="text-sm divide-y divide-slate-100">
              <li v-for="(a, i) in ft(q.questionId).answers" :key="i" class="py-2">
                <span class="text-slate-800">{{ a.text }}</span>
                <span v-if="a.userId === null" class="text-violet-500 text-xs ml-2 italic">anonym</span>
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
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
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
const responseRatePct = computed(() => Math.round((results.value?.responseRate ?? 0) * 100))

// Horizontal bars (indexAxis 'y') so long/translated option labels get full width;
// long tick labels are truncated, with the full text available via the tooltip title.
const LABEL_MAX = 28
const opts = {
  responsive: true,
  indexAxis: 'y' as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items: { dataIndex: number; chart: { data: { labels?: unknown[] } } }[]) => {
          const idx = items[0]?.dataIndex ?? 0
          return String(items[0]?.chart.data.labels?.[idx] ?? '')
        },
      },
    },
  },
  scales: {
    y: {
      ticks: {
        callback(this: { getLabelForValue(v: number): string }, value: string | number) {
          const label = this.getLabelForValue(value as number)
          return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label
        },
      },
    },
  },
}

interface FtState {
  q: string
  page: number
  total: number
  answers: FreeTextAnswerDto[]
  loaded: boolean
  expanded: boolean
  csvMsg: string
}
const ftState = reactive<Record<string, FtState>>({})

// Lazily create per-question free-text state (template renders before onMounted populates).
function ft(qid: string): FtState {
  if (!ftState[qid]) ftState[qid] = { q: '', page: 1, total: 0, answers: [], loaded: false, expanded: false, csvMsg: '' }
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

async function toggleFreeText(qid: string) {
  const st = ft(qid)
  st.expanded = !st.expanded
  if (st.expanded && !st.loaded) {
    await loadFreeText(qid, 1)
  }
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
  const st = ft(qid)
  await adminApi.surveyFreeTextCsv(id, qid)
  st.csvMsg = 'Export gestartet'
  setTimeout(() => {
    st.csvMsg = ''
  }, 3000)
}

onMounted(async () => {
  try {
    results.value = await adminApi.surveyResults(id)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Laden fehlgeschlagen'
  }
})
</script>
