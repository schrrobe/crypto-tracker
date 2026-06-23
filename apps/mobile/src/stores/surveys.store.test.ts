import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/api.client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}))

import { api } from '../services/api.client'
import { useSurveysStore } from './surveys.store'

const mockApi = api as unknown as { get: Mock; post: Mock }

function survey(id: string) {
  return { id, title: `Survey ${id}`, description: null, status: 'PUBLISHED', questions: [] }
}

describe('surveys.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi.get.mockReset()
    mockApi.post.mockReset()
  })

  it('loadPending fills pending from the API', async () => {
    mockApi.get.mockResolvedValue({ surveys: [survey('a'), survey('b')] })
    const store = useSurveysStore()
    await store.loadPending()
    expect(mockApi.get).toHaveBeenCalledWith('/surveys/pending')
    expect(store.pending.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('getSurvey unwraps the survey envelope', async () => {
    mockApi.get.mockResolvedValue({ survey: survey('x') })
    const store = useSurveysStore()
    const s = await store.getSurvey('x')
    expect(mockApi.get).toHaveBeenCalledWith('/surveys/x')
    expect(s.id).toBe('x')
  })

  it('submit posts the payload and drops the survey from pending', async () => {
    mockApi.get.mockResolvedValue({ surveys: [survey('a'), survey('b')] })
    mockApi.post.mockResolvedValue(undefined)
    const store = useSurveysStore()
    await store.loadPending()

    const payload = { answers: [{ questionId: 'q1', text: 'hi' }] }
    await store.submit('a', payload)

    expect(mockApi.post).toHaveBeenCalledWith('/surveys/a/responses', payload)
    expect(store.pending.map((s) => s.id)).toEqual(['b'])
  })

  it('reset clears pending', async () => {
    mockApi.get.mockResolvedValue({ surveys: [survey('a')] })
    const store = useSurveysStore()
    await store.loadPending()
    expect(store.pending).toHaveLength(1)
    store.reset()
    expect(store.pending).toHaveLength(0)
  })
})
