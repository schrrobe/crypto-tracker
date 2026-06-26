import type { Plan } from '@prisma/client'
import {
  QuestionType,
  SurveyStatus,
  type AdminSurveyDetailDto,
  type CreateSurveyInput,
  type FreeTextAnswerListDto,
  type SurveyAudienceDto,
  type SurveyAudienceQuery,
  type SurveyFreeTextQuery,
  type SurveyListDto,
  type SurveyResultsDto,
  type SurveyReminderResultDto,
  type UpdateSurveyInput,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { recordAudit, AuditAction, type AuditActor } from './audit.service'
import { eligibleUserWhere } from '../surveys/targeting'
import { getNotificationChannel } from '../../lib/notifications'

// Minimum gap between reminders for one survey — guards against notification fatigue
// (an admin spamming non-responders). 24h.
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function listSurveys(): Promise<SurveyListDto> {
  const surveys = await prisma.survey.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { questions: true, responses: true } } },
  })

  // Eligible-user denominator per survey. Untargeted surveys all share the same count
  // (all non-suspended users), so compute that once and only run extra queries for the
  // surveys that actually target a subset — bounds the query count.
  const broadcastCount = await prisma.user.count({ where: { suspendedAt: null } })
  const eligibleCounts = await Promise.all(
    surveys.map((s) =>
      s.targetPlans.length === 0 && s.targetCurrencies.length === 0
        ? Promise.resolve(broadcastCount)
        : prisma.user.count({ where: eligibleUserWhere(s) }),
    ),
  )

  return {
    surveys: surveys.map((s, i) => ({
      id: s.id,
      title: s.title,
      status: s.status as SurveyStatus,
      anonymous: s.anonymous,
      targetPlans: s.targetPlans,
      targetCurrencies: s.targetCurrencies,
      questionCount: s._count.questions,
      responseCount: s._count.responses,
      eligibleCount: eligibleCounts[i] ?? 0,
      createdAt: s.createdAt.toISOString(),
      publishedAt: s.publishedAt?.toISOString() ?? null,
      closedAt: s.closedAt?.toISOString() ?? null,
      lastRemindedAt: s.lastRemindedAt?.toISOString() ?? null,
    })),
  }
}

// Full editable survey for the builder's edit-draft mode.
export async function getSurveyDetail(surveyId: string): Promise<AdminSurveyDetailDto> {
  const survey = await prisma.survey.findUnique({
    where: { id: surveyId },
    include: { questions: { include: { options: true }, orderBy: { order: 'asc' } } },
  })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    status: survey.status as SurveyStatus,
    anonymous: survey.anonymous,
    targetPlans: survey.targetPlans,
    targetCurrencies: survey.targetCurrencies,
    questions: survey.questions.map((q) => ({
      type: q.type as QuestionType,
      prompt: q.prompt,
      options: q.options.sort((a, b) => a.order - b.order).map((o) => ({ label: o.label })),
    })),
  }
}

// Live count of users a given targeting selection would reach (builder confidence).
export async function countAudience(query: SurveyAudienceQuery): Promise<SurveyAudienceDto> {
  const count = await prisma.user.count({
    where: eligibleUserWhere({ targetPlans: query.plans as Plan[], targetCurrencies: query.currencies }),
  })
  return { count }
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
      anonymous: input.anonymous,
      targetPlans: input.targetPlans as Plan[],
      targetCurrencies: input.targetCurrencies,
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
        // Anonymity + targeting are editable only while DRAFT (this whole path is
        // draft-gated above) — never after responses exist under a given contract.
        ...(input.anonymous !== undefined ? { anonymous: input.anonymous } : {}),
        ...(input.targetPlans !== undefined ? { targetPlans: input.targetPlans as Plan[] } : {}),
        ...(input.targetCurrencies !== undefined ? { targetCurrencies: input.targetCurrencies } : {}),
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
  // answeredCounts: responses that actually answered a question (non-empty), the
  // per-question drop-off funnel. A row exists per (response, question) even when the
  // user skipped it, so "answered" = non-empty text OR a selected option.
  const answeredCounts = new Map<string, number>()
  for (const a of answers) {
    const hasText = !!a.text && a.text.trim().length > 0
    const hasOptions = a.optionIds.length > 0
    for (const optId of a.optionIds) {
      optionCounts.set(optId, (optionCounts.get(optId) ?? 0) + 1)
    }
    if (hasText) {
      freeTextCounts.set(a.questionId, (freeTextCounts.get(a.questionId) ?? 0) + 1)
    }
    if (hasText || hasOptions) {
      answeredCounts.set(a.questionId, (answeredCounts.get(a.questionId) ?? 0) + 1)
    }
  }

  // Response-rate denominator: targeted, non-suspended users.
  const eligibleCount = await prisma.user.count({ where: eligibleUserWhere(survey) })
  const responseCount = survey._count.responses
  const responseRate = eligibleCount > 0 ? Math.min(1, responseCount / eligibleCount) : 0

  return {
    id: survey.id,
    title: survey.title,
    status: survey.status as SurveyStatus,
    anonymous: survey.anonymous,
    responseCount,
    eligibleCount,
    responseRate,
    questions: survey.questions.map((q) => ({
      questionId: q.id,
      type: q.type as QuestionType,
      prompt: q.prompt,
      options: q.options
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ optionId: o.id, label: o.label, count: optionCounts.get(o.id) ?? 0 })),
      freeTextCount: freeTextCounts.get(q.id) ?? 0,
      answeredCount: answeredCounts.get(q.id) ?? 0,
    })),
  }
}

async function getFreeTextAnswers(surveyId: string, query: SurveyFreeTextQuery) {
  // Ensure the question belongs to this survey and is FREE_TEXT; pull the survey's
  // anonymity flag in the same round-trip so callers can decide whether to expose userId.
  const question = await prisma.surveyQuestion.findFirst({
    where: { id: query.questionId, surveyId, type: QuestionType.FREE_TEXT },
    include: { survey: { select: { anonymous: true } } },
  })
  if (!question) throw AppError.notFound('Frage nicht gefunden')

  const where = {
    questionId: query.questionId,
    text: { not: null, ...(query.q ? { contains: query.q, mode: 'insensitive' as const } : {}) },
  }
  return { where, anonymous: question.survey.anonymous }
}

export async function listFreeTextAnswers(
  surveyId: string,
  query: SurveyFreeTextQuery,
): Promise<FreeTextAnswerListDto> {
  const { where, anonymous } = await getFreeTextAnswers(surveyId, query)
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
      // Anonymous surveys never reveal who wrote what \u2014 userId stays stored (for
      // one-per-user dedup) but is withheld from admins.
      userId: anonymous ? null : r.response.userId,
      createdAt: r.response.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  }
}

// All free-text answers for one question as CSV (no pagination). Auditable: a bulk
// export of identifiable user opinions is exactly the admin action worth recording.
export async function freeTextCsv(
  actor: AuditActor,
  surveyId: string,
  questionId: string,
): Promise<string> {
  const { where, anonymous } = await getFreeTextAnswers(surveyId, {
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
  // Anonymous surveys drop the userId column entirely.
  const header = (anonymous ? ['createdAt', 'answer'] : ['userId', 'createdAt', 'answer']).join(',')
  const lines = rows.map((r) => {
    const cells = anonymous
      ? [escape(r.response.createdAt.toISOString()), escape(r.text ?? '')]
      : [escape(r.response.userId), escape(r.response.createdAt.toISOString()), escape(r.text ?? '')]
    return cells.join(',')
  })

  await recordAudit({
    actor,
    action: AuditAction.SURVEY_FREETEXT_EXPORTED,
    targetType: 'SURVEY',
    targetId: surveyId,
    metadata: { questionId, rowCount: rows.length, anonymous },
  })

  // Prepend a UTF-8 BOM so Excel renders umlauts/Cyrillic correctly.
  return '\ufeff' + [header, ...lines].join('\n')
}

// Notify eligible users who have not yet responded. Real out-of-band delivery is not
// available yet (see lib/notifications.ts) \u2014 this computes the audience, dispatches via
// the registered channel, and records the action. Cooldown-guarded to prevent fatigue.
export async function remindNonResponders(
  actor: AuditActor,
  surveyId: string,
): Promise<SurveyReminderResultDto> {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } })
  if (!survey) throw AppError.notFound('Umfrage nicht gefunden')
  if (survey.status !== SurveyStatus.PUBLISHED) {
    throw AppError.conflict('SURVEY_NOT_PUBLISHED', 'Nur ver\u00f6ffentlichte Umfragen k\u00f6nnen erinnert werden')
  }

  const eligible = await prisma.user.findMany({
    where: eligibleUserWhere(survey),
    select: { id: true },
  })
  const eligibleCount = eligible.length

  const responded = await prisma.surveyResponse.findMany({
    where: { surveyId },
    select: { userId: true },
  })
  const respondedIds = new Set(responded.map((r) => r.userId))
  const nonResponderIds = eligible.map((u) => u.id).filter((id) => !respondedIds.has(id))
  const alreadyResponded = eligibleCount - nonResponderIds.length

  // Cooldown: refuse a fresh reminder within the window. Returns state instead of
  // throwing so the admin UI can show "already reminded recently".
  const now = Date.now()
  if (survey.lastRemindedAt && now - survey.lastRemindedAt.getTime() < REMINDER_COOLDOWN_MS) {
    return {
      notified: 0,
      eligibleCount,
      alreadyResponded,
      skippedCooldown: true,
      lastRemindedAt: survey.lastRemindedAt.toISOString(),
    }
  }

  if (nonResponderIds.length > 0) {
    await getNotificationChannel().notifySurveyReminder(nonResponderIds, {
      id: survey.id,
      title: survey.title,
    })
  }

  const sentAt = new Date()
  await prisma.survey.update({ where: { id: surveyId }, data: { lastRemindedAt: sentAt } })
  await recordAudit({
    actor,
    action: AuditAction.SURVEY_REMINDER_SENT,
    targetType: 'SURVEY',
    targetId: surveyId,
    metadata: { notified: nonResponderIds.length, eligibleCount },
  })

  return {
    notified: nonResponderIds.length,
    eligibleCount,
    alreadyResponded,
    skippedCooldown: false,
    lastRemindedAt: sentAt.toISOString(),
  }
}
