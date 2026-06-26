<template>
  <div class="max-w-3xl">
    <h1 class="text-2xl font-semibold mb-4">Neue Umfrage</h1>

    <p v-if="error" class="text-red-600 text-sm mb-3">{{ error }}</p>

    <div class="bg-white rounded-lg shadow-sm p-4 space-y-3 mb-4">
      <div>
        <label class="block text-sm text-slate-600 mb-1">Titel</label>
        <input v-model="title" class="w-full border border-slate-300 rounded px-3 py-2 text-sm" />
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
        <div class="flex flex-wrap gap-1.5 mb-1">
          <span
            v-for="(c, ci) in targetCurrencies"
            :key="c"
            class="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs rounded px-2 py-0.5"
          >
            {{ c }}
            <button class="text-slate-400 hover:text-red-600" @click="targetCurrencies.splice(ci, 1)">×</button>
          </span>
        </div>
        <input
          v-model="currencyInput"
          placeholder="z. B. EUR, USD"
          class="w-full border border-slate-300 rounded px-3 py-2 text-sm"
          @keyup.enter="addCurrencies"
          @keydown.,.prevent="addCurrencies"
          @blur="addCurrencies"
        />
        <p class="text-xs text-slate-400 mt-1">Komma oder Enter trennt Codes; keine Auswahl = alle Währungen</p>
      </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CreateSurveyInput } from '@crypto-tracker/shared'
import { adminApi } from '../services/admin'
import { ApiError } from '../services/api.client'

type QType = 'FREE_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE'
interface QuestionForm {
  type: QType
  prompt: string
  options: { label: string }[]
}

const router = useRouter()
const title = ref('')
const description = ref('')
const anonymous = ref(false)
const targetPlans = ref<('FREE' | 'PRO')[]>([])
const targetCurrencies = ref<string[]>([])
const currencyInput = ref('')
const questions = ref<QuestionForm[]>([{ type: 'FREE_TEXT', prompt: '', options: [] }])
const error = ref('')
const saving = ref(false)

function isChoice(t: QType): boolean {
  return t === 'SINGLE_CHOICE' || t === 'MULTI_CHOICE'
}

function addCurrencies() {
  const codes = currencyInput.value
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
  for (const c of codes) {
    if (!targetCurrencies.value.includes(c)) targetCurrencies.value.push(c)
  }
  currencyInput.value = ''
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

async function save() {
  error.value = ''
  saving.value = true
  addCurrencies()
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
    await adminApi.createSurvey(payload)
    router.push('/surveys')
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'
  } finally {
    saving.value = false
  }
}
</script>
