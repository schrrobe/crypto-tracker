import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, keyPreview } from './crypto'

describe('crypto', () => {
  it('verschlüsselt und entschlüsselt roundtrip', () => {
    const secret = 'kraken-api-secret-äöü-🔑'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('erzeugt pro Aufruf einen anderen Ciphertext (zufälliger IV)', () => {
    expect(encryptSecret('gleich')).not.toBe(encryptSecret('gleich'))
  })

  it('wirft bei manipuliertem Ciphertext (GCM-AuthTag)', () => {
    const stored = encryptSecret('geheim')
    const parts = stored.split(':')
    const tampered = Buffer.from(parts[2]!, 'base64')
    tampered[0] = tampered[0]! ^ 0xff
    const manipulated = `${parts[0]}:${parts[1]}:${tampered.toString('base64')}`
    expect(() => decryptSecret(manipulated)).toThrow()
  })

  it('wirft bei kaputtem Format', () => {
    expect(() => decryptSecret('kein-gueltiges-format')).toThrow()
  })

  it('keyPreview zeigt nur die letzten 4 Zeichen', () => {
    expect(keyPreview('ABCDEFGH1234')).toBe('…1234')
  })
})
