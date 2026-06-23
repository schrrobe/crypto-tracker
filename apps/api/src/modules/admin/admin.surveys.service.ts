import {
  QuestionType,
  SurveyStatus,
  type CreateSurveyInput,
  type FreeTextAnswerListDto,
  type SurveyFreeTextQuery,
  type SurveyListDto,
  type SurveyResultsDto,
  type UpdateSurveyInput,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { recordAudit, AuditAction, type AuditActor } from './audit.service'

export async function listSurveys(): Promise<SurveyListDto> {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { questions: true, responses: true } } },
  })
  return {
    surveys: surveys.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status as SurveyStatus,
      questionCount: s._count.questions,
      responseCount: s._count.responses,
      createdAt: s.createdAt.toISOString(),
      publishedAt: s.publishedAt?.toISOString() ?? null,
      closedAt: s.closedAt?.toISOString() ?? null,
    })),
  }
}

async function getSurveyOr404(surveyId: string) {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')
  return survey
}

function questionCreateData(questions: CreateSurveyInput['questions']) {
  return questions.map((q, qi) => ({
    type: q.type,
    prompt: q.prompt,
    order: qi,
    options: {
      create: (q.options ?? []).map((o, oi) => ({ label: o.label, order: oi })),
    },
  }))
}

export async function createSurvey(actor: AuditActor, input: CreateSurveyInput): Promise<{ id: string }> {
  const survey = await prisma.survey.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      questions: { create: questionCreateData(input.questions) },
    },
  })
  await recordAudit({ actor, action: AuditAction.SURVEY_CREATED, targetType: 'SURVEY', targetId: survey.id })
  return { id: survey.id }
}

export async function updateSurvey(actor: AuditActor, surveyId: string, input: UpdateSurveyInput): Promise<void> {
  const survey = await getSurveyOr404(surveyId)
  if (survey.status !== SurveyStatus.DRAFT) {
    throw AppError.conflict('SURVEY_NOT_EDITABLE', 'Nur Entwürfe können bearbeitet werden')
  }
  await prisma.$transaction(async (tx) => {
    // Replace questions wholesale when provided — drafts have no answers yet.
    if (input.questions) {
      await tx.surveyQuestion.deleteMany({ where: { surveyId } })
    }
    await tx.survey.update({
      where: { id: surveyId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.questions ? { questions: { create: questionCreateData(input.questions) } } : {}),
      },
    })
  })
  await recordAudit({ actor, action: AuditAction.SURVEY_UPDATED, targetType: 'SURVEY', targetId: surveyId })
}

export async function publishSurvey(actor: AuditActor, surveyId: string): Promise<void> {
  const survey = await getSurveyOr404(surveyId)
  if (survey.status !== SurveyStatus.DRAFT) {
    throw AppError.conflict('SURVEY_NOT_DRAFT', 'Nur Entwürfe können veröffentlicht werden')
  }
  await prisma.survey.update({
    where: { id: surveyId },
    data: { status: SurveyStatus.PUBLISHED, publishedAt: new Date() },
  })
  await recordAudit({ actor, action: AuditAction.SURVEY_PUBLISHED, targetType: 'SURVEY', targetId: surveyId })
}

export async function closeSurvey(actor: AuditActor, surveyId: string): Promise<void> {
  const survey = await getSurveyOr404(surveyId)
  if (survey.status !== SurveyStatus.PUBLISHED) {
    throw AppError.conflict('SURVEY_NOT_PUBLISHED', 'Nur veröffentlichte Umfragen können geschlossen werden')
  }
  await prisma.survey.update({
    where: { id: surveyId },
    data: { status: SurveyStatus.CLOSED, closedAt: new Date() },
  })
  await recordAudit({ actor, action: AuditAction.SURVEY_CLOSED, targetType: 'SURVEY', targetId: surveyId })
}

export async function deleteSurvey(actor: AuditActor, surveyId: string): Promise<void> {
  await getSurveyOr404(surveyId)
  // Delete responses first (cascades to their answers) so that the subsequent
  // survey delete can cascade-delete the questions without tripping the
  // RESTRICT FK on SurveyAnswer.questionId. Deleting the survey directly is
  // unsafe: Postgres does not guarantee the response→answer cascade runs
  // before the question cascade, so answers may still reference a question
  // being deleted → FK violation.
  await prisma.$transaction([
    prisma.surveyResponse.deleteMany({ where: { surveyId } }),
    prisma.survey.delete({ where: { id: surveyId } }),
  ])
  await recordAudit({ actor, action: AuditAction.SURVEY_DELETED, targetType: 'SURVEY', targetId: surveyId })
}

export async function getResults(surveyId: string): Promise<SurveyResultsDto> {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: {
      questions: { include: { options: true }, orderBy: { order: 'asc' } },
      _count: { select: { responses: true } },
    },
  })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')

  // All answers for this survey's questions, fetched once and aggregated in memory.
  const answers = await prisma.surveyAnswer.findMany({
    where: { question: { surveyId } },
    select: { questionId: true, optionIds: true, text: true },
  })

  const optionCounts = new Map<string, number>()
  const freeTextCounts = new Map<string, number>()
  for (const a of answers) {
    for (const optId of a.optionIds) {
      optionCounts.set(optId, (optionCounts.get(optId) ?? 0) + 1)
    }
    if (a.text && a.text.trim().length > 0) {
      freeTextCounts.set(a.questionId, (freeTextCounts.get(a.questionId) ?? 0) + 1)
    }
  }

  return {
    id: survey.id,
    title: survey.title,
    status: survey.status as SurveyStatus,
    responseCount: survey._count.responses,
    questions: survey.questions.map((q) => ({
      questionId: q.id,
      type: q.type as QuestionType,
      prompt: q.prompt,
      options: q.options
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ optionId: o.id, label: o.label, count: optionCounts.get(o.id) ?? 0 })),
      freeTextCount: freeTextCounts.get(q.id) ?? 0,
    })),
  }
}

async function getFreeTextAnswers(surveyId: string, query: SurveyFreeTextQuery) {
  // Ensure the question belongs to this survey and is FREE_TEXT.
  const question = await prisma.surveyQuestion.findFirst({
    where: { id: query.questionId, surveyId, type: QuestionType.FREE_TEXT },
  })
  if (!question) throw AppError.notFound('Frage nicht gefunden')

  const where = {
    questionId: query.questionId,
    text: { not: null, ...(query.q ? { contains: query.q, mode: 'insensitive' as const } : {}) },
  }
  return { where }
}

export async function listFreeTextAnswers(
  surveyId: string,
  query: SurveyFreeTextQuery,
): Promise<FreeTextAnswerListDto> {
  const { where } = await getFreeTextAnswers(surveyId, query)
  const [total, rows] = await Promise.all([
    prisma.surveyAnswer.count({ where }),
    prisma.surveyAnswer.findMany({
      where,
      include: { response: { select: { userId: true, createdAt: true } } },
      // id tiebreaker: createdAt alone is not unique, so rows could repeat or
      // be skipped across pages when several answers share a timestamp.
      orderBy: [{ response: { createdAt: 'desc' } }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])
  return {
    answers: rows.map((r) => ({
      text: r.text ?? '',
      userId: r.response.userId,
      createdAt: r.response.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

// All free-text answers for one question as CSV (no pagination).
export async function freeTextCsv(surveyId: string, questionId: string): Promise<string> {
  const { where } = await getFreeTextAnswers(surveyId, {
    questionId,
    page: 1,
    pageSize: 1,
  } as SurveyFreeTextQuery)
  const rows = await prisma.surveyAnswer.findMany({
    where,
    include: { response: { select: { userId: true, createdAt: true } } },
    orderBy: [{ response: { createdAt: 'desc' } }, { id: 'asc' }],
  })
  // Neutralize spreadsheet formula injection: a cell starting with = + - @ (or a
  // leading tab/CR) is executed as a formula by Excel/Sheets. User-authored
  // answers are untrusted, so prefix such values with a single quote.
  const escape = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
    return `"${safe.replace(/"/g, '""')}"`
  }
  const header = ['userId', 'createdAt', 'answer'].join(',')
  const lines = rows.map((r) =>
    [escape(r.response.userId), escape(r.response.createdAt.toISOString()), escape(r.text ?? '')].join(','),
  )
  // Prepend a UTF-8 BOM so Excel renders umlauts/Cyrillic correctly.
  return '\ufeff' + [header, ...lines].join('\n')
}
