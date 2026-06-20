import nodemailer from 'nodemailer'
import { env } from '../config/env'

// Email sending is optional: mail is only actually sent when SMTP_HOST is set.
// Without SMTP configuration (local) the message lands in the API log —
// so the password reset flow works even without a mail server.

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

// Liveness check for the SMTP connection (used by the admin health endpoint).
// Throws if not configured or the server is unreachable.
export async function verifySmtp(): Promise<void> {
  if (!transporter) throw new Error('SMTP nicht konfiguriert')
  await transporter.verify()
}

export async function sendMail(mail: Mail): Promise<void> {
  if (!transporter) {
    // Console fallback: no SMTP configured (local/dev without mail server)
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
