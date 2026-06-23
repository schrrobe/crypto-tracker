import { Prisma } from '@prisma/client'
import {
  QuestionType,
  SurveyStatus,
  type SubmitSurveyResponseInput,
  type SurveyDto,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

type SurveyWithQuestions = Prisma.SurveyGetPayload<{
  include: { questions: { include: { options: true } } }
}>

export function toSurveyDto(s: SurveyWithQuestions): SurveyDto {
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    status: s.status as SurveyStatus,
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

// Published surveys the user has not yet answered — powers the dashboard banner.
export async function listPendingSurveys(userId: string): Promise<SurveyDto[]> {
  const surveys = await prisma.survey.findMany({
    where: {
      status: SurveyStatus.PUBLISHED,
      responses: { none: { userId } },
    },
    include: { questions: { include: { options: true } } },
    orderBy: { publishedAt: 'desc' },
  })
  return surveys.map(toSurveyDto)
}

// Single published survey for filling out. 404 unless PUBLISHED (drafts/closed are invisible to users).
export async function getPublishedSurvey(userId: string, surveyId: string): Promise<SurveyDto> {
  const survey = await prisma.survey.findFirst({
    where: { id: surveyId, status: SurveyStatus.PUBLISHED },
    include: { questions: { include: { options: true } } },
  })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')
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
