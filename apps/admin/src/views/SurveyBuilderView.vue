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
const questions = ref<QuestionForm[]>([{ type: 'FREE_TEXT', prompt: '', options: [] }])
const error = ref('')
const saving = ref(false)

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

async function save() {
  error.value = ''
  saving.value = true
  try {
    const payload: CreateSurveyInput = {
      title: title.value.trim(),
      description: description.value.trim() || undefined,
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
