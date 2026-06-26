<template>
  <div class="max-w-3xl">
    <h1 class="text-2xl font-semibold mb-4">{{ isEdit ? 'Umfrage bearbeiten' : 'Neue Umfrage' }}</h1>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

    <!-- Non-draft surveys cannot be edited -->
    <div v-if="notEditable" class="bg-white rounded-lg shadow-sm p-4">
      <p class="text-sm text-slate-600 mb-3">Nur Entwürfe können bearbeitet werden.</p>
      <button class="rounded border border-slate-300 text-sm px-3 py-2 hover:bg-slate-50" @click="router.push('/surveys')">
        ← Zurück zur Übersicht
      </button>
    </div>

    <template v-else>
      <div class="bg-white rounded-lg shadow-sm p-4 space-y-3 mb-4">
        <div>
          <label class="block text-sm text-slate-600 mb-1">Titel</label>
          <input v-model="title" class="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
          <p v-if="errors.title" class="text-xs text-red-600 mt-1">{{ errors.title }}</p>
        </div>
        <div>
          <label class="block text-sm text-slate-600 mb-1">Beschreibung (optional)</label>
          <textarea v-model="description" rows="2" class="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
        </div>

        <label class="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" v-model="anonymous" class="rounded border-slate-300" />
          Anonyme Umfrage (Antworten werden nicht mit der Identität verknüpft)
        </label>

        <div>
          <label class="block text-sm text-slate-600 mb-1">Zielgruppe: Pläne</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" value="FREE" v-model="targetPlans" class="rounded border-slate-300" />
              FREE
            </label>
            <label class="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" value="PRO" v-model="targetPlans" class="rounded border-slate-300" />
              PRO
            </label>
          </div>
          <p class="text-xs text-slate-400 mt-1">Keine Auswahl = alle Pläne</p>
        </div>

        <div>
          <label class="block text-sm text-slate-600 mb-1">Zielgruppe: Währungen</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" value="EUR" v-model="targetCurrencies" class="rounded border-slate-300" />
              EUR
            </label>
            <label class="flex items-center gap-1.5 text-sm text-slate-700">
              <input type="checkbox" value="USD" v-model="targetCurrencies" class="rounded border-slate-300" />
              USD
            </label>
          </div>
          <p class="text-xs text-slate-400 mt-1">Keine Auswahl = alle Währungen</p>
        </div>

        <p class="text-sm text-slate-700">Erreicht aktuell ~{{ audienceCount }} Nutzer</p>
      </div>

      <div v-for="(q, qi) in questions" :key="qi" class="bg-white rounded-lg shadow-sm p-4 space-y-3 mb-3">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium text-slate-600">Frage {{ qi + 1 }}</h3>
          <button class="text-red-600 text-sm hover:underline" @click="questions.splice(qi, 1)">Entfernen</button>
        </div>
        <div class="flex gap-2">
          <select v-model="q.type" class="border border-slate-300 rounded px-2 py-2 text-sm" @change="onTypeChange(q)">
            <option value="FREE_TEXT">Freitext</option>
            <option value="SINGLE_CHOICE">Einfachauswahl</option>
            <option value="MULTI_CHOICE">Mehrfachauswahl</option>
          </select>
          <input
            v-model="q.prompt"
            placeholder="Fragetext"
            class="flex-1 border border-slate-300 rounded px-3 py-2 text-sm"
          />
        </div>
        <p v-if="errors.questions[qi]" class="text-xs text-red-600">{{ errors.questions[qi] }}</p>

        <div v-if="isChoice(q.type)" class="space-y-2 pl-2">
          <div v-for="(o, oi) in q.options" :key="oi" class="flex gap-2 items-center">
            <input
              v-model="o.label"
              placeholder="Antwortoption"
              class="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm"
            />
            <button class="text-red-600 text-sm hover:underline" @click="q.options.splice(oi, 1)">×</button>
          </div>
          <button class="text-slate-700 text-sm hover:underline" @click="q.options.push({ label: '' })">
            + Option
          </button>
        </div>
      </div>

      <div class="flex gap-2">
        <button class="rounded border border-slate-300 text-sm px-3 py-2 hover:bg-slate-50" @click="addQuestion">
          + Frage hinzufügen
        </button>
        <button
          class="rounded bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-700 disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          Als Entwurf speichern
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CreateSurveyInput, UpdateSurveyInput } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'

type QType = 'FREE_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE'
interface QuestionForm {
  type: QType
  prompt: string
  options: { label: string }[]
}

const route = useRoute()
const router = useRouter()
const editId = (route.params.id as string | undefined) || null
const isEdit = ref(!!editId)

const title = ref('')
const description = ref('')
const anonymous = ref(false)
const targetPlans = ref<('FREE' | 'PRO')[]>([])
const targetCurrencies = ref<('EUR' | 'USD')[]>([])
const questions = ref<QuestionForm[]>([{ type: 'FREE_TEXT', prompt: '', options: [] }])
const error = ref('')
const saving = ref(false)
const notEditable = ref(false)
const audienceCount = ref(0)

const errors = reactive<{ title: string; questions: string[] }>({ title: '', questions: [] })

function isChoice(t: QType): boolean {
  return t === 'SINGLE_CHOICE' || t === 'MULTI_CHOICE'
}

function addQuestion() {
  questions.value.push({ type: 'FREE_TEXT', prompt: '', options: [] })
}

function onTypeChange(q: QuestionForm) {
  if (isChoice(q.type) && q.options.length === 0) {
    q.options = [{ label: '' }, { label: '' }]
  }
  if (!isChoice(q.type)) q.options = []
}

// ── Live audience size (debounced) ──────────────────────────────────────────
let audienceTimer: ReturnType<typeof setTimeout> | undefined
async function refreshAudience() {
  try {
    const res = await adminApi.surveyAudience([...targetPlans.value], [...targetCurrencies.value])
    audienceCount.value = res.count
  } catch {
    // non-critical; leave previous count
  }
}
watch(
  [targetPlans, targetCurrencies],
  () => {
    if (audienceTimer) clearTimeout(audienceTimer)
    audienceTimer = setTimeout(refreshAudience, 300)
  },
  { deep: true },
)

// ── Inline validation ───────────────────────────────────────────────────────
function validate(): boolean {
  errors.title = ''
  errors.questions = questions.value.map(() => '')
  let ok = true
  if (!title.value.trim()) {
    errors.title = 'Titel darf nicht leer sein'
    ok = false
  }
  questions.value.forEach((q, i) => {
    if (!q.prompt.trim()) {
      errors.questions[i] = 'Frage darf nicht leer sein'
      ok = false
    } else if (isChoice(q.type)) {
      const labels = q.options.filter((o) => o.label.trim()).length
      if (labels < 2) {
        errors.questions[i] = 'Auswahlfragen brauchen mindestens 2 Antwortoptionen'
        ok = false
      }
    }
  })
  return ok
}

async function save() {
  error.value = ''
  if (!validate()) return
  saving.value = true
  try {
    const payload: CreateSurveyInput = {
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      anonymous: anonymous.value,
      targetPlans: targetPlans.value,
      targetCurrencies: targetCurrencies.value,
      questions: questions.value.map((q) => ({
        type: q.type,
        prompt: q.prompt.trim(),
        options: isChoice(q.type) ? q.options.map((o) => ({ label: o.label.trim() })) : undefined,
      })),
    }
    if (editId) {
      await adminApi.updateSurvey(editId, payload as UpdateSurveyInput)
    } else {
      await adminApi.createSurvey(payload)
    }
    router.push('/surveys')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (editId) {
    try {
      const s = await adminApi.survey(editId)
      if (s.status !== 'DRAFT') {
        notEditable.value = true
        return
      }
      title.value = s.title
      description.value = s.description ?? ''
      anonymous.value = s.anonymous
      targetPlans.value = [...s.targetPlans] as ('FREE' | 'PRO')[]
      targetCurrencies.value = [...s.targetCurrencies] as ('EUR' | 'USD')[]
      questions.value = s.questions.map((q) => ({
        type: q.type as QType,
        prompt: q.prompt,
        options: q.options.map((o) => ({ label: o.label })),
      }))
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : 'Laden fehlgeschlagen'
    }
  }
  void refreshAudience()
})
</script>
