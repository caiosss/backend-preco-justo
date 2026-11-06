import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { optionalAuth } from '../../middlewares/auth.js'
import { parseBody } from '../../middlewares/validate.js'
import { EVENT_TYPES, recordEvents } from './events.service.js'

/**
 * Recebe os eventos de uso do app em lotes. Funciona com ou sem login (a tela de entrar também conta).
 * A conta de administrador não entra nas estatísticas.
 */
export const eventsRoutes = Router()

const metaValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])

const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  path: z.string().max(300).default('/'),
  target: z.string().max(300).optional(),
  value: z.number().finite().min(0).max(1e9).optional(),
  meta: z
    .record(z.string().max(40), metaValue)
    .refine((m) => Object.keys(m).length <= 12, 'Detalhes demais no evento.')
    .optional(),
  at: z.iso.datetime({ offset: true }).optional(),
})

const batchSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Sessão inválida.'),
  events: z.array(eventSchema).min(1).max(100),
})

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Eventos demais. Aguarde um pouco.' },
})

eventsRoutes.post('/', limiter, optionalAuth, async (req, res) => {
  const { sessionId, events } = parseBody(batchSchema, req.body)
  let userId: string | null = null
  let userName: string | null = null
  if (req.userId) {
    const { rows } = await pool.query<{ name: string; role: string }>(`SELECT name, role FROM users WHERE id = $1`, [req.userId])
    if (rows[0]?.role === 'admin') {
      res.status(204).end()
      return
    }
    if (rows[0]) {
      userId = req.userId
      userName = rows[0].name
    }
  }
  await recordEvents(userId, userName, sessionId, events)
  res.status(204).end()
})
