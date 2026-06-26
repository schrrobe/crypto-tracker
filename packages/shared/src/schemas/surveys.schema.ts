import { z } from 'zod'
import { QuestionType, SurveyStatus } from '../enums'
import type { Plan } from './auth.schema'

// Targeting axes mirror columns on the User model (plan, baseCurrency). An empty
// array means "no restriction on this axis" — so a survey with no targeting at all
// reaches every (non-suspended) user, preserving the original broadcast behaviour.
const PLAN_VALUES = ['FREE', 'PRO'] as const
// The app only supports EUR/USD as a user base currency (see settings), so targeting is
// constrained to that set rather than free text — a typo'd code can't silently target
// nobody.
export const SURVEY_TARGET_CURRENCIES = ['EUR', 'USD'] as const
export const surveyTargetingSchema = z.object({
  targetPlans: z.array(z.enum(PLAN_VALUES)).max(PLAN_VALUES.length).optional().default([]),
  targetCurrencies: z
    .array(z.enum(SURVEY_TARGET_CURRENCIES))
    .max(SURVEY_TARGET_CURRENCIES.length)
    .optional()
    .default([]),
})

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

export const createSurveySchema = z
  .object({
    title: z.string().trim().min(1, 'Titel darf nicht leer sein').max(200),
    description: z.string().trim().max(2000).optional(),
    // Anonymous surveys never expose userId in results, free-text listings, or CSV.
    // Set at creation, editable only while DRAFT (enforced server-side) — flipping it
    // after responses exist would retroactively change the privacy contract users
    // answered under.
    anonymous: z.boolean().optional().default(false),
    questions: z.array(questionInputSchema).min(1, 'Mindestens eine Frage erforderlich').max(50),
  })
  .merge(surveyTargetingSchema)
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
  // Surfaced so the mobile UI can show an "anonymous" badge — telling the user their
  // answers are not tied to their identity is what makes free-text feedback honest.
  anonymous: boolean
  questions: SurveyQuestionDto[]
}

// Admin list row.
export interface SurveyListItemDto {
  id: string
  title: string
  status: SurveyStatus
  anonymous: boolean
  targetPlans: Plan[]
  targetCurrencies: string[]
  questionCount: number
  responseCount: number
  // Number of (non-suspended) users this survey targets — the denominator for response rate.
  eligibleCount: number
  createdAt: string
  publishedAt: string | null
  closedAt: string | null
  lastRemindedAt: string | null
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
  // How many responses actually answered this question (drop-off funnel: a question
  // answered by far fewer responses than responseCount signals confusion or fatigue).
  answeredCount: number
}

export interface SurveyResultsDto {
  id: string
  title: string
  status: SurveyStatus
  anonymous: boolean
  responseCount: number
  // Denominator for the response rate: targeted, non-suspended users.
  eligibleCount: number
  // responseCount / eligibleCount, clamped to [0,1]; 0 when eligibleCount is 0.
  responseRate: number
  questions: SurveyQuestionResultDto[]
}

export interface FreeTextAnswerDto {
  text: string
  // null for anonymous surveys — the response is still stored against a user (for
  // one-per-user dedup) but the identity is never returned to admins.
  userId: string | null
  createdAt: string
}

export interface FreeTextAnswerListDto {
  answers: FreeTextAnswerDto[]
  total: number
  page: number
  pageSize: number
}

// Result of an admin "remind non-responders" action.
export interface SurveyReminderResultDto {
  // Eligible users who had not yet responded and were notified this run.
  notified: number
  eligibleCount: number
  alreadyResponded: number
  // True when the request was within the cooldown window and no reminder was sent.
  skippedCooldown: boolean
  lastRemindedAt: string | null
}

// Admin: full editable survey (drives the edit-draft form). Mirrors the create input shape
// plus identifiers/status so the builder can load an existing draft.
export interface AdminSurveyQuestionDto {
  type: QuestionType
  prompt: string
  options: { label: string }[]
}

export interface AdminSurveyDetailDto {
  id: string
  title: string
  description: string | null
  status: SurveyStatus
  anonymous: boolean
  targetPlans: Plan[]
  targetCurrencies: string[]
  questions: AdminSurveyQuestionDto[]
}

// Admin: live audience size for a targeting selection (shown in the builder before saving).
export const surveyAudienceQuerySchema = z.object({
  // CSV of plan codes; empty/absent = no plan restriction.
  plans: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((p) => p.trim()).filter(Boolean) : []))
    .pipe(z.array(z.enum(PLAN_VALUES)).max(PLAN_VALUES.length)),
  currencies: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean) : []))
    .pipe(z.array(z.enum(SURVEY_TARGET_CURRENCIES)).max(SURVEY_TARGET_CURRENCIES.length)),
})
export type SurveyAudienceQuery = z.infer<typeof surveyAudienceQuerySchema>

export interface SurveyAudienceDto {
  count: number
}
