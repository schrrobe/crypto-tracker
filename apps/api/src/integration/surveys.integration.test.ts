import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app, bearer, makeAdmin, registerUser } from './helpers'

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
})
