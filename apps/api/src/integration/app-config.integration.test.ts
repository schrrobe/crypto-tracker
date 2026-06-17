import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { API, app } from './helpers'

describe('App-Config (Integration)', () => {
  it('ist ohne Auth erreichbar und liefert alle Gate-Felder', async () => {
    const res = await request(app).get(`${API}/app/config`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      minClientVersionAndroid: null,
      minClientVersionIos: null,
      storeUrlAndroid: null,
      storeUrlIos: null,
    })
  })
})
