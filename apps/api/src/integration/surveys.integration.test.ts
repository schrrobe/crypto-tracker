import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, makeAdmin, registerUser } from './helpers'
import { prisma } from '../lib/prisma'

// Create + publish a survey with an arbitrary body (targeting / anonymity).
async function createPublished(
  admin: Awaited<ReturnType<typeof registerUser>>,
  body: Record<string, unknown>,
) {
  const create = await request(app).post(`${API}/admin/surveys`).set(...bearer(admin)).send(body)
  expect(create.status).toBe(201)
  const id = create.body.id as string
  const publish = await request(app).post(`${API}/admin/surveys/${id}/publish`).set(...bearer(admin))
  expect(publish.status).toBe(204)
  return id
}

// Build a survey with one of each question type and publish it.
async function createPublishedSurvey(admin: Awaited<ReturnType<typeof registerUser>>) {
  const create = await request(app)
    .post(`${API}/admin/surveys`)
    .set(...bearer(admin))
    .send({
      title: 'Feature-Wunsch',
      description: 'Was wünscht ihr euch?',
      questions: [
        { type: 'SINGLE_CHOICE', prompt: 'Lieblingsfarbe?', options: [{ label: 'Rot' }, { label: 'Blau' }] },
        { type: 'MULTI_CHOICE', prompt: 'Welche Features?', options: [{ label: 'Charts' }, { label: 'PDF' }] },
        { type: 'FREE_TEXT', prompt: 'Sonstiges?' },
      ],
    })
  expect(create.status).toBe(201)
  const surveyId = create.body.id as string

  const publish = await request(app).post(`${API}/admin/surveys/${surveyId}/publish`).set(...bearer(admin))
  expect(publish.status).toBe(204)
  return surveyId
}

describe('Surveys (Integration)', () => {
  it('requireAdmin: Nicht-Admin → 404 auf /admin/surveys', async () => {
    const user = await registerUser('survey-nonadmin', 'FREE')
    const res = await request(app).get(`${API}/admin/surveys`).set(...bearer(user))
    expect(res.status).toBe(404)
  })

  it('Lebenszyklus: erstellen → veröffentlichen → ausfüllen → auswerten', async () => {
    const admin = await registerUser('survey-admin', 'FREE')
    await makeAdmin(admin)
    const surveyId = await createPublishedSurvey(admin)

    // user sees it as pending
    const user = await registerUser('survey-user', 'FREE')
    const pending = await request(app).get(`${API}/surveys/pending`).set(...bearer(user))
    expect(pending.status).toBe(200)
    // DB is shared across test files; assert our survey is present rather than the total count.
    const survey = pending.body.surveys.find((s: { id: string }) => s.id === surveyId)
    expect(survey).toBeDefined()
    const single = survey.questions.find((q: { type: string }) => q.type === 'SINGLE_CHOICE')
    const multi = survey.questions.find((q: { type: string }) => q.type === 'MULTI_CHOICE')
    const free = survey.questions.find((q: { type: string }) => q.type === 'FREE_TEXT')

    // submit a response
    const submit = await request(app)
      .post(`${API}/surveys/${surveyId}/responses`)
      .set(...bearer(user))
      .send({
        answers: [
          { questionId: single.id, optionIds: [single.options[0].id] },
          { questionId: multi.id, optionIds: [multi.options[0].id, multi.options[1].id] },
          { questionId: free.id, text: 'Mehr Dark Mode bitte' },
        ],
      })
    expect(submit.status).toBe(204)

    // no longer pending for this user
    const after = await request(app).get(`${API}/surveys/pending`).set(...bearer(user))
    expect(after.body.surveys.find((s: { id: string }) => s.id === surveyId)).toBeUndefined()

    // results aggregate correctly
    const results = await request(app).get(`${API}/admin/surveys/${surveyId}/results`).set(...bearer(admin))
    expect(results.status).toBe(200)
    expect(results.body.responseCount).toBe(1)
    const singleRes = results.body.questions.find((q: { type: string }) => q.type === 'SINGLE_CHOICE')
    expect(singleRes.options.find((o: { label: string }) => o.label === 'Rot').count).toBe(1)
    expect(singleRes.options.find((o: { label: string }) => o.label === 'Blau').count).toBe(0)
    const freeRes = results.body.questions.find((q: { type: string }) => q.type === 'FREE_TEXT')
    expect(freeRes.freeTextCount).toBe(1)

    // free-text listing + search
    const ft = await request(app)
      .get(`${API}/admin/surveys/${surveyId}/free-text?questionId=${free.id}&q=Dark`)
      .set(...bearer(admin))
    expect(ft.status).toBe(200)
    expect(ft.body.total).toBe(1)
    expect(ft.body.answers[0].text).toContain('Dark Mode')
  })

  it('eine Antwort pro Nutzer: zweite Abgabe → 409', async () => {
    const admin = await registerUser('survey-dup-admin', 'FREE')
    await makeAdmin(admin)
    const surveyId = await createPublishedSurvey(admin)
    const user = await registerUser('survey-dup-user', 'FREE')

    const single = (await request(app).get(`${API}/surveys/${surveyId}`).set(...bearer(user))).body.survey.questions.find(
      (q: { type: string }) => q.type === 'SINGLE_CHOICE',
    )
    const payload = { answers: [{ questionId: single.id, optionIds: [single.options[0].id] }] }

    const first = await request(app).post(`${API}/surveys/${surveyId}/responses`).set(...bearer(user)).send(payload)
    expect(first.status).toBe(204)

    const second = await request(app).post(`${API}/surveys/${surveyId}/responses`).set(...bearer(user)).send(payload)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('SURVEY_ALREADY_SUBMITTED')
  })

  it('Entwurf ist für Nutzer unsichtbar (404) und nicht pending', async () => {
    const admin = await registerUser('survey-draft-admin', 'FREE')
    await makeAdmin(admin)
    const create = await request(app)
      .post(`${API}/admin/surveys`)
      .set(...bearer(admin))
      .send({ title: 'Entwurf', questions: [{ type: 'FREE_TEXT', prompt: 'Test?' }] })
    const draftId = create.body.id as string

    const user = await registerUser('survey-draft-user', 'FREE')
    const get = await request(app).get(`${API}/surveys/${draftId}`).set(...bearer(user))
    expect(get.status).toBe(404)
    const pending = await request(app).get(`${API}/surveys/pending`).set(...bearer(user))
    expect(pending.body.surveys.find((s: { id: string }) => s.id === draftId)).toBeUndefined()
  })

  it('Targeting: nur Nutzer im Zielsegment sehen die Umfrage', async () => {
    const admin = await registerUser('survey-target-admin', 'PRO')
    await makeAdmin(admin)
    const id = await createPublished(admin, {
      title: 'Nur PRO',
      targetPlans: ['PRO'],
      questions: [{ type: 'FREE_TEXT', prompt: 'Feedback?' }],
    })

    const freeUser = await registerUser('survey-target-free', 'FREE')
    const proUser = await registerUser('survey-target-pro', 'PRO')

    // FREE user: invisible (404) and not pending; cannot submit (404).
    expect((await request(app).get(`${API}/surveys/${id}`).set(...bearer(freeUser))).status).toBe(404)
    const freePending = await request(app).get(`${API}/surveys/pending`).set(...bearer(freeUser))
    expect(freePending.body.surveys.find((s: { id: string }) => s.id === id)).toBeUndefined()
    const q = (await request(app).get(`${API}/surveys/${id}`).set(...bearer(proUser))).body.survey
    const submitFree = await request(app)
      .post(`${API}/surveys/${id}/responses`)
      .set(...bearer(freeUser))
      .send({ answers: [{ questionId: q.questions[0].id, text: 'nope' }] })
    expect(submitFree.status).toBe(404)

    // PRO user: visible and pending.
    expect((await request(app).get(`${API}/surveys/${id}`).set(...bearer(proUser))).status).toBe(200)
    const proPending = await request(app).get(`${API}/surveys/pending`).set(...bearer(proUser))
    expect(proPending.body.surveys.find((s: { id: string }) => s.id === id)).toBeDefined()
  })

  it('Anonyme Umfrage: userId wird nirgends preisgegeben, Export wird auditiert', async () => {
    const admin = await registerUser('survey-anon-admin', 'PRO')
    await makeAdmin(admin)
    const id = await createPublished(admin, {
      title: 'Anonym',
      anonymous: true,
      questions: [{ type: 'FREE_TEXT', prompt: 'Ehrliche Meinung?' }],
    })

    const user = await registerUser('survey-anon-user', 'PRO')
    const survey = (await request(app).get(`${API}/surveys/${id}`).set(...bearer(user))).body.survey
    expect(survey.anonymous).toBe(true)
    const qId = survey.questions[0].id
    await request(app)
      .post(`${API}/surveys/${id}/responses`)
      .set(...bearer(user))
      .send({ answers: [{ questionId: qId, text: 'streng geheim' }] })
      .expect(204)

    // Results: flagged anonymous.
    const results = (await request(app).get(`${API}/admin/surveys/${id}/results`).set(...bearer(admin))).body
    expect(results.anonymous).toBe(true)

    // Free-text list: userId withheld (null), text still present.
    const list = (
      await request(app)
        .get(`${API}/admin/surveys/${id}/free-text?questionId=${qId}`)
        .set(...bearer(admin))
    ).body
    expect(list.answers.length).toBeGreaterThan(0)
    expect(list.answers[0].userId).toBeNull()
    expect(list.answers[0].text).toBe('streng geheim')

    // CSV: no userId column; export audited.
    const csv = await request(app)
      .get(`${API}/admin/surveys/${id}/free-text/export.csv?questionId=${qId}`)
      .set(...bearer(admin))
    expect(csv.status).toBe(200)
    expect(csv.text).toContain('createdAt,answer')
    expect(csv.text).not.toContain('userId')
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'SURVEY_FREETEXT_EXPORTED', targetId: id },
    })
    expect(audit).not.toBeNull()
  })

  it('Erinnerung: zweite Erinnerung im Cooldown-Fenster wird übersprungen', async () => {
    const admin = await registerUser('survey-remind-admin', 'PRO')
    await makeAdmin(admin)
    const id = await createPublished(admin, {
      title: 'Erinnerung',
      questions: [{ type: 'SINGLE_CHOICE', prompt: 'A oder B?', options: [{ label: 'A' }, { label: 'B' }] }],
    })

    const first = await request(app).post(`${API}/admin/surveys/${id}/remind`).set(...bearer(admin))
    expect(first.status).toBe(200)
    expect(first.body.skippedCooldown).toBe(false)
    expect(typeof first.body.notified).toBe('number')
    expect(typeof first.body.eligibleCount).toBe('number')
    expect(first.body.lastRemindedAt).not.toBeNull()

    const second = await request(app).post(`${API}/admin/surveys/${id}/remind`).set(...bearer(admin))
    expect(second.status).toBe(200)
    expect(second.body.skippedCooldown).toBe(true)
    expect(second.body.notified).toBe(0)

    // Reminder is audited.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'SURVEY_REMINDER_SENT', targetId: id },
    })
    expect(audit).not.toBeNull()
  })

  it('Analytics: eligibleCount/responseRate Nenner und answeredCount Funnel', async () => {
    const admin = await registerUser('survey-analytics-admin', 'PRO')
    await makeAdmin(admin)
    const id = await createPublished(admin, {
      title: 'Analytics',
      targetPlans: ['PRO'],
      questions: [{ type: 'SINGLE_CHOICE', prompt: 'A oder B?', options: [{ label: 'A' }, { label: 'B' }] }],
    })

    const user = await registerUser('survey-analytics-user', 'PRO')
    const survey = (await request(app).get(`${API}/surveys/${id}`).set(...bearer(user))).body.survey
    const qId = survey.questions[0].id
    const optId = survey.questions[0].options[0].id
    await request(app)
      .post(`${API}/surveys/${id}/responses`)
      .set(...bearer(user))
      .send({ answers: [{ questionId: qId, optionIds: [optId] }] })
      .expect(204)

    const results = (await request(app).get(`${API}/admin/surveys/${id}/results`).set(...bearer(admin))).body
    expect(results.responseCount).toBeGreaterThanOrEqual(1)
    // eligibleCount counts PRO users (the target); always >= responders.
    expect(results.eligibleCount).toBeGreaterThanOrEqual(results.responseCount)
    expect(results.responseRate).toBeGreaterThan(0)
    expect(results.responseRate).toBeLessThanOrEqual(1)
    // Everyone who responded answered the single question.
    expect(results.questions[0].answeredCount).toBe(results.responseCount)
  })

  it('Admin-Detail: liefert die editierbare Umfrage inkl. Zielgruppe und Fragen', async () => {
    const admin = await registerUser('survey-detail-admin', 'PRO')
    await makeAdmin(admin)
    const create = await request(app)
      .post(`${API}/admin/surveys`)
      .set(...bearer(admin))
      .send({
        title: 'Detail',
        description: 'Beschreibung',
        anonymous: true,
        targetPlans: ['PRO'],
        targetCurrencies: ['EUR'],
        questions: [{ type: 'SINGLE_CHOICE', prompt: 'A?', options: [{ label: 'A' }, { label: 'B' }] }],
      })
    expect(create.status).toBe(201)
    const detail = await request(app).get(`${API}/admin/surveys/${create.body.id}`).set(...bearer(admin))
    expect(detail.status).toBe(200)
    expect(detail.body.title).toBe('Detail')
    expect(detail.body.anonymous).toBe(true)
    expect(detail.body.status).toBe('DRAFT')
    expect(detail.body.targetPlans).toEqual(['PRO'])
    expect(detail.body.targetCurrencies).toEqual(['EUR'])
    expect(detail.body.questions[0].options.map((o: { label: string }) => o.label)).toEqual(['A', 'B'])
  })

  it('Audience: zählt Nutzer im Zielsegment (Untermenge ≤ alle)', async () => {
    const admin = await registerUser('survey-audience-admin', 'PRO')
    await makeAdmin(admin)
    const all = await request(app).get(`${API}/admin/surveys/audience`).set(...bearer(admin))
    expect(all.status).toBe(200)
    expect(typeof all.body.count).toBe('number')
    const pro = await request(app)
      .get(`${API}/admin/surveys/audience?plans=PRO`)
      .set(...bearer(admin))
    expect(pro.status).toBe(200)
    expect(pro.body.count).toBeLessThanOrEqual(all.body.count)
    // Invalid plan code is rejected by the query schema.
    const bad = await request(app)
      .get(`${API}/admin/surveys/audience?plans=GOLD`)
      .set(...bearer(admin))
    expect(bad.status).toBe(400)
  })
})
