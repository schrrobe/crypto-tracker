import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../config/env'

// AES-256-GCM für API-Keys/Secrets. Format: base64(iv):base64(authTag):base64(ciphertext)
// Entschlüsselung passiert ausschließlich unmittelbar vor Provider-Calls (SyncService) —
// Secrets verlassen das Backend nie und tauchen in keiner API-Response auf.

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex')

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join(':')
}

export function decryptSecret(stored: string): string {
  const [iv, authTag, ciphertext] = stored.split(':').map((part) => Buffer.from(part, 'base64'))
  if (!iv || !authTag || !ciphertext) throw new Error('Ungültiges Secret-Format')
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function keyPreview(apiKey: string): string {
  return `…${apiKey.slice(-4)}`
}
