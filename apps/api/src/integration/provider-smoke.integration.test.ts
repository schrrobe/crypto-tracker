import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { EXCHANGE_PROVIDERS, PASSPHRASE_REQUIRED_PROVIDERS, WALLET_PROVIDERS } from '@crypto-tracker/shared'
import { API, app, bearer, registerUser } from './helpers'

// Verkabelungs-Smoke über ALLE Provider (Fake-Registry): Quelle anlegen +
// syncen muss für jede ProviderId funktionieren — fängt vergessene Enum-/
// Registry-/Schema-Einträge beim nächsten Provider-Ausbau ab.

describe('Provider-Verkabelung (Smoke)', () => {
  it('jeder Exchange-Provider lässt sich anlegen und syncen', async () => {
    const user = await registerUser('smoke-ex')
    for (const provider of EXCHANGE_PROVIDERS) {
      const needsPassphrase = (PASSPHRASE_REQUIRED_PROVIDERS as readonly string[]).includes(provider)
      const created = await request(app)
        .post(`${API}/sources`)
        .set(...bearer(user))
        .send({
          type: 'EXCHANGE',
          provider,
          label: `Smoke ${provider}`,
          apiKey: 'valid-key-1234',
          apiSecret: 'valid-secret',
          ...(needsPassphrase ? { passphrase: 'pass-123' } : {}),
        })
      expect(created.status, provider).toBe(201)

      const sync = await request(app)
        .post(`${API}/sources/${created.body.source.id}/sync`)
        .set(...bearer(user))
      expect(sync.body.run.status, provider).toBe('SUCCESS')
    }
  })

  it('jeder Wallet-Provider lässt sich anlegen und syncen', async () => {
    const user = await registerUser('smoke-w')
    for (const provider of WALLET_PROVIDERS) {
      const created = await request(app)
        .post(`${API}/sources`)
        .set(...bearer(user))
        .send({
          type: 'WALLET',
          provider,
          label: `Smoke ${provider}`,
          address: `smoke-address-${provider.toLowerCase()}`,
        })
      expect(created.status, provider).toBe(201)

      const sync = await request(app)
        .post(`${API}/sources/${created.body.source.id}/sync`)
        .set(...bearer(user))
      expect(sync.body.run.status, provider).toBe('SUCCESS')
    }
  })

  it('OKX/KuCoin ohne Passphrase werden abgelehnt', async () => {
    const user = await registerUser('smoke-pass')
    for (const provider of PASSPHRASE_REQUIRED_PROVIDERS) {
      const res = await request(app)
        .post(`${API}/sources`)
        .set(...bearer(user))
        .send({ type: 'EXCHANGE', provider, label: 'Ohne Pass', apiKey: 'valid-key-1234', apiSecret: 'valid-secret' })
      expect(res.status, provider).toBe(400)
    }
  })
})
