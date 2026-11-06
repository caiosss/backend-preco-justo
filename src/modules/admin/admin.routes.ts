import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../../middlewares/auth.js'
import { HttpError } from '../../utils/HttpError.js'
import { pool } from '../../db/pool.js'
import { type LiveEvent, liveBus, notifyDataChanged } from '../events/events.service.js'
import { getOverview } from './admin.service.js'

/** Painel do administrador: números de uso do sistema e um canal ao vivo (SSE). */
export const adminRoutes = Router()

adminRoutes.use(requireAdmin)

const daysSchema = z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'Período inválido.').default(30)

adminRoutes.get('/overview', async (req, res) => {
  const days = daysSchema.safeParse(req.query.days ?? undefined)
  if (!days.success) throw new HttpError(400, 'Período inválido. Use 7, 30 ou 90 dias.')
  res.set('Cache-Control', 'no-store')
  res.json(await getOverview(days.data))
})

/** A visita anônima à tela de entrar feita pelo próprio admin não entra nas estatísticas. */
adminRoutes.post('/forget-session', async (req, res) => {
  const sessionId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).safeParse(req.body?.sessionId)
  if (!sessionId.success) throw new HttpError(400, 'Sessão inválida.')
  await pool.query(`DELETE FROM usage_events WHERE session_id = $1 AND user_id IS NULL`, [sessionId.data])
  notifyDataChanged()
  res.status(204).end()
})

/**
 * Ao vivo: cada evento novo chega ao painel na hora ("events"); dados salvos avisam "changed".
 * O app lê com fetch (para mandar o token no cabeçalho), então não depende do EventSource.
 */
adminRoutes.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx (front no Railway) não pode segurar a resposta em buffer
    'X-Accel-Buffering': 'no',
  })
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  send('hello', { at: new Date().toISOString() })

  const onLive = (events: LiveEvent[]) => send('events', events)
  const onChanged = () => send('changed', { at: new Date().toISOString() })
  liveBus.on('live', onLive)
  liveBus.on('changed', onChanged)
  // Mantém a conexão aberta atrás de proxies que derrubam conexões paradas
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000)

  req.on('close', () => {
    clearInterval(ping)
    liveBus.off('live', onLive)
    liveBus.off('changed', onChanged)
  })
})
