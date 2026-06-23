import { z } from 'zod'
import { QuestionType, SurveyStatus } from '../enums'

const QUESTION_TYPES = Object.values(QuestionType) as [QuestionType, ...QuestionType[]]

// ── Admin: create / update a survey ────────────────────────────────────────

const optionInputSchema = z.object({
  label: z.string().trim().min(1, 'Antwortoption darf nicht leer sein').max(200),
})

const questionInputSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().trim().min(1, 'Frage darf nicht leer sein').max(500),
    options: z.array(optionInputSchema).max(20).optional(),
  })
  .superRefine((q, ctx) => {
    const isChoice = q.type === QuestionType.SINGLE_CHOICE || q.type === QuestionType.MULTI_CHOICE
    const count = q.options?.length ?? 0
    if (isChoice && count < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Auswahlfragen brauchen mindestens 2 Optionen', path: ['options'] })
    }
    if (!isChoice && count > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Freitextfragen dürfen keine Optionen haben', path: ['options'] })
    }
  })

export const createSurveySchema = z.object({
  title: z.string().trim().min(1, 'Titel darf nicht leer sein').max(200),
  description: z.string().trim().max(2000).optional(),
  questions: z.array(questionInputSchema).min(1, 'Mindestens eine Frage erforderlich').max(50),
})
export type CreateSurveyInput = z.infer<typeof createSurveySchema>

export const updateSurveySchema = createSurveySchema.partial()
export type UpdateSurveyInput = z.infer<typeof updateSurveySchema>

// ── User: submit a response ─────────────────────────────────────────────────

export const submitSurveyResponseSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        text: z.string().trim().max(5000).optional(),
        optionIds: z.array(z.string().uuid()).max(20).optional(),
      }),
    )
    .min(1, 'Mindestens eine Antwort erforderlich'),
})
export type SubmitSurveyResponseInput = z.infer<typeof submitSurveyResponseSchema>

// ── Admin: free-text answer listing query ───────────────────────────────────

export const surveyFreeTextQuerySchema = z.object({
  questionId: z.string().uuid(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
export type SurveyFreeTextQuery = z.infer<typeof surveyFreeTextQuerySchema>

// ── DTOs ────────────────────────────────────────────────────────────────────

export interface SurveyOptionDto {
  id: string
  label: string
  order: number
}

export interface SurveyQuestionDto {
  id: string
  type: QuestionType
  prompt: string
  order: number
  options: SurveyOptionDto[]
}

// User-facing survey (no answer/result data).
export interface SurveyDto {
  id: string
  title: string
  description: string | null
  status: SurveyStatus
  questions: SurveyQuestionDto[]
}

// Admin list row.
export interface SurveyListItemDto {
  id: string
  title: string
  status: SurveyStatus
  questionCount: number
  responseCount: number
  createdAt: string
  publishedAt: string | null
  closedAt: string | null
}

export interface SurveyListDto {
  surveys: SurveyListItemDto[]
}

// Admin results: choice aggregates per question; free-text questions carry counts only.
export interface SurveyOptionResultDto {
  optionId: string
  label: string
  count: number
}

export interface SurveyQuestionResultDto {
  questionId: string
  type: QuestionType
  prompt: string
  // populated for SINGLE_CHOICE / MULTI_CHOICE
  options: SurveyOptionResultDto[]
  // populated for FREE_TEXT — total non-empty answers
  freeTextCount: number
}

export interface SurveyResultsDto {
  id: string
  title: string
  status: SurveyStatus
  responseCount: number
  questions: SurveyQuestionResultDto[]
}

export interface FreeTextAnswerDto {
  text: string
  userId: string
  createdAt: string
}

export interface FreeTextAnswerListDto {
  answers: FreeTextAnswerDto[]
  total: number
  page: number
  pageSize: number
}
