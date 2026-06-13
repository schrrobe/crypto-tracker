import nodemailer from 'nodemailer'
import { env } from '../config/env'

// E-Mail-Versand ist optional: nur wenn SMTP_HOST gesetzt ist, wird wirklich
// versendet. Ohne SMTP-Konfiguration (local) landet die Nachricht im API-Log —
// so funktioniert der Passwort-Reset-Flow auch ohne Mailserver.

interface Mail {
  to: string
  subject: string
  text: string
}

const transporter =
  env.SMTP_HOST && env.SMTP_PORT
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      })
    : null

export const mailerConfigured = transporter !== null

export async function sendMail(mail: Mail): Promise<void> {
  if (!transporter) {
    // Konsolen-Fallback: kein SMTP konfiguriert (local/dev ohne Mailserver)
    console.info(
      `[mailer] Kein SMTP konfiguriert — E-Mail an ${mail.to} nicht versendet.\n` +
        `Betreff: ${mail.subject}\n${mail.text}`,
    )
    return
  }
  await transporter.sendMail({
    from: env.SMTP_FROM ?? env.SMTP_USER ?? 'no-reply@crypto-tracker.local',
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  })
}
