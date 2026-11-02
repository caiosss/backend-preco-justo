import { env } from '../config/env.js'

type Mail = { to: string; subject: string; html: string; text: string }

/**
 * Envia e-mail pela API HTTP do Resend (o Railway bloqueia SMTP nos planos Hobby).
 * Sem RESEND_API_KEY, em desenvolvimento o conteúdo vai para o log; em produção a falta é avisada no log.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === 'production') {
      console.error('RESEND_API_KEY não configurada: e-mail não enviado.')
    } else {
      console.log(`✉ E-mail para ${mail.to}: ${mail.subject}\n${mail.text}`)
    }
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    throw new Error(`Resend respondeu ${res.status}: ${await res.text().catch(() => '')}`)
  }
}
