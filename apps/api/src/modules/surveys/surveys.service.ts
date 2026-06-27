import { Prisma } from '@prisma/client'
import {
  QuestionType,
  SurveyStatus,
  type SubmitSurveyResponseInput,
  type SurveyDto,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { userMatchesTarget } from './targeting'

type SurveyWithQuestions = Prisma.SurveyGetPayload<{
  include: { questions: { include: { options: true } } }
}>

export function toSurveyDto(s: SurveyWithQuestions): SurveyDto {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    status: s.status as SurveyStatus,
    anonymous: s.anonymous,
    questions: [...s.questions]
      .sort((a, b) => a.order - b.order)
      .map((q) => ({
        id: q.id,
        type: q.type as QuestionType,
        prompt: q.prompt,
        order: q.order,
        options: [...q.options]
          .sort((a, b) => a.order - b.order)
          .map((o) => ({ id: o.id, label: o.label, order: o.order })),
      })),
  }
}

// Minimal user fields needed for targeting decisions. `suspendedAt` is loaded so the
// read path can exclude suspended users — they are absent from the eligible-user
// denominator (eligibleUserWhere has suspendedAt: null), so serving them surveys would
// be inconsistent.
async function getTargetableUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, baseCurrency: true, suspendedAt: true },
  })
  if (!user) throw AppError.notFound('Benutzer nicht gefunden')
  return user
}

// Published surveys the user has not yet answered AND is targeted by — powers the
// dashboard banner.
export async function listPendingSurveys(userId: string): Promise<SurveyDto[]> {
  const user = await getTargetableUser(userId)
  // Suspended users are not in the eligible audience — show them nothing.
  if (user.suspendedAt) return []
  const surveys = await prisma.survey.findMany({
    where: {
      status: SurveyStatus.PUBLISHED,
      responses: { none: { userId } },
    },
    include: { questions: { include: { options: true } } },
    orderBy: { publishedAt: 'desc' },
  })
  // Filter by targeting in memory: the published set is small, and "empty array = all"
  // does not express cleanly as a single SQL predicate across many surveys.
  return surveys.filter((s) => userMatchesTarget(user, s)).map(toSurveyDto)
}

// Single published survey for filling out. 404 unless PUBLISHED (drafts/closed are
// invisible to users) and the user is within the survey's target audience — an
// untargeted user gets the same 404 as a non-existent survey (no existence leak).
export async function getPublishedSurvey(userId: string, surveyId: string): Promise<SurveyDto> {
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, status: SurveyStatus.PUBLISHED },
    include: { questions: { include: { options: true } } },
  })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')
  const user = await getTargetableUser(userId)
  // Suspended or off-target users get the same 404 as a non-existent survey (no leak).
  if (user.suspendedAt || !userMatchesTarget(user, survey)) {
    throw AppError.notFound('Umfrage nicht gefunden')
  }
  return toSurveyDto(survey)
}

export async function submitResponse(
  userId: string,
  surveyId: string,
  input: SubmitSurveyResponseInput,
): Promise<void> {
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, status: SurveyStatus.PUBLISHED },
    include: { questions: { include: { options: true } } },
  })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')
  // Same targeting gate as getPublishedSurvey: a user outside the audience cannot submit
  // (404, not 403 — no existence leak), so results never include off-target responses.
  const user = await getTargetableUser(userId)
  if (user.suspendedAt || !userMatchesTarget(user, survey)) {
    throw AppError.notFound('Umfrage nicht gefunden')
  }

  const questionsById = new Map(survey.questions.map((q) => [q.id, q]))

  // Reject more than one answer for the same question — duplicates would each
  // create a SurveyAnswer row and inflate the aggregated result counts.
  const seenQuestionIds = new Set<string>()

  // Validate each answer against its question type before writing anything.
  const answerData = input.answers.map((a) => {
    const question = questionsById.get(a.questionId)
    if (!question) {
      throw AppError.badRequest('SURVEY_INVALID_ANSWER', 'Antwort verweist auf unbekannte Frage')
    }
    if (seenQuestionIds.has(a.questionId)) {
      throw AppError.badRequest('SURVEY_INVALID_ANSWER', 'Mehrfache Antwort auf dieselbe Frage')
    }
    seenQuestionIds.add(a.questionId)

    if (question.type === QuestionType.FREE_TEXT) {
      if (a.optionIds && a.optionIds.length > 0) {
        throw AppError.badRequest('SURVEY_INVALID_ANSWER', 'Freitextfrage erlaubt keine Auswahloptionen')
      }
      return { questionId: question.id, text: a.text?.trim() || null, optionIds: [] }
    }

    // choice question — validate selected options belong to the question.
    // De-duplicate selections: a repeated optionId would otherwise inflate counts.
    const validOptionIds = new Set(question.options.map((o) => o.id))
    const selected = [...new Set(a.optionIds ?? [])]
    if (selected.some((id) => !validOptionIds.has(id))) {
      throw AppError.badRequest('SURVEY_INVALID_ANSWER', 'Ungültige Antwortoption')
    }
    if (question.type === QuestionType.SINGLE_CHOICE && selected.length > 1) {
      throw AppError.badRequest('SURVEY_INVALID_ANSWER', 'Diese Frage erlaubt nur eine Antwort')
    }
    return { questionId: question.id, text: null, optionIds: selected }
  })

  try {
    await prisma.surveyResponse.create({
      data: {
        surveyId,
        userId,
        answers: { create: answerData },
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw AppError.conflict('SURVEY_ALREADY_SUBMITTED', 'Diese Umfrage wurde bereits beantwortet')
    }
    throw err
  }
}
