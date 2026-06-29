import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env'

// AES-256-GCM for API keys/secrets.
// Format: v1:base64(iv):base64(authTag):base64(ciphertext)
// The version prefix makes key rotation possible without re-encrypting blindly —
// a future v2 can pick a different key by prefix. Legacy blobs without a prefix
// (iv:tag:ct) are still readable. Decryption happens exclusively in the backend —
// secrets never leave it and never appear in any API response.

const KEY_VERSION = 'v1'
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex')

// Resolve the key for a given version. Add cases here when rotating.
function keyForVersion(version: string): Buffer {
  if (version === 'v1') return KEY
  throw new Error(`Unbekannte Encryption-Key-Version: ${version}`)
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [KEY_VERSION, ...[iv, authTag, ciphertext].map((b) => b.toString('base64'))].join(':')
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  // Versioned (v1:iv:tag:ct) vs legacy (iv:tag:ct).
  const [version, ivB64, tagB64, ctB64] = parts.length === 4 ? parts : ['v1', ...parts]
  const iv = ivB64 ? Buffer.from(ivB64, 'base64') : undefined
  const authTag = tagB64 ? Buffer.from(tagB64, 'base64') : undefined
  const ciphertext = ctB64 ? Buffer.from(ctB64, 'base64') : undefined
  if (!iv || !authTag || !ciphertext || !version) throw new Error('Ungültiges Secret-Format')
  const decipher = createDecipheriv('aes-256-gcm', keyForVersion(version), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function keyPreview(apiKey: string): string {
  return `…${apiKey.slice(-4)}`
}
