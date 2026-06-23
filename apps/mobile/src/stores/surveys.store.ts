import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SubmitSurveyResponseInput, SurveyDto } from '@crypto-tracker/shared'
import { api } from '../services/api.client'

export const useSurveysStore = defineStore('surveys', () => {
  // Published surveys the user has not yet answered (powers the dashboard banner).
  const pending = ref<SurveyDto[]>([])

  async function loadPending(): Promise<void> {
    pending.value = (await api.get<{ surveys: SurveyDto[] }>('/surveys/pending')).surveys
  }

  async function getSurvey(id: string): Promise<SurveyDto> {
    return (await api.get<{ survey: SurveyDto }>(`/surveys/${id}`)).survey
  }

  async function submit(id: string, input: SubmitSurveyResponseInput): Promise<void> {
    await api.post(`/surveys/${id}/responses`, input)
    // drop the answered survey from the pending banner
    pending.value = pending.value.filter((s) => s.id !== id)
  }

  function reset(): void {
    pending.value = []
  }

  return { pending, loadPending, getSurvey, submit, reset }
})
