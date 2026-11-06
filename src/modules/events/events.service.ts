import { EventEmitter } from 'node:events'
import { pool } from '../../db/pool.js'
import { areaOf, normalizePath } from './areas.js'

/**
 * Eventos de uso do app: telas abertas, tempo em cada tela, botões tocados, erros e ações concluídas.
 * Nada do que a pessoa digita é guardado: só a tela, o texto do botão e as mensagens do próprio app.
 */
export const EVENT_TYPES = [
  'session_start',
  'heartbeat',
  'page_view',
  'page_time',
  'click',
  'rage_click',
  'form_error',
  'success',
  'js_error',
] as const
/** Registrados pelo próprio servidor */
export type ServerEventType = 'login' | 'register' | 'password_reset' | 'assistant_question'

export type IncomingEvent = {
  type: (typeof EVENT_TYPES)[number]
  path: string
  target?: string | undefined
  value?: number | undefined
  meta?: Record<string, string | number | boolean | null> | undefined
  at?: string | undefined
}

/** Evento como aparece no feed ao vivo do painel. */
export type LiveEvent = {
  id: string
  type: string
  area: string
  path: string
  target: string | null
  userName: string | null
  at: string
}

/** Avisa o painel aberto (SSE) a cada evento novo ou dado salvo. Vale por réplica da API. */
export const liveBus = new EventEmitter()
liveBus.setMaxListeners(200)

export const SERVER_SESSION = 'servidor'
const DAY_MS = 24 * 60 * 60 * 1000

type InsertedRow = { id: string; type: string; area: string; path: string; target: string | null; created_at: Date }

/** Guarda um lote de eventos do app. Eventos com hora estranha (relógio do aparelho errado) usam a hora de agora. */
export async function recordEvents(userId: string | null, userName: string | null, sessionId: string, events: IncomingEvent[]) {
  const now = Date.now()
  const rows = events.map((e) => {
    const at = e.at ? Date.parse(e.at) : NaN
    const createdAt = Number.isFinite(at) && at <= now + 60_000 && at >= now - DAY_MS ? new Date(Math.min(at, now)) : new Date(now)
    const path = normalizePath(e.path)
    return {
      user_id: userId,
      session_id: sessionId,
      type: e.type,
      path,
      area: areaOf(path),
      target: e.target?.trim().slice(0, 160) || null,
      value: e.value ?? null,
      meta: e.meta ?? {},
      created_at: createdAt.toISOString(),
    }
  })
  const { rows: inserted } = await pool.query<InsertedRow>(
    `INSERT INTO usage_events (user_id, session_id, type, path, area, target, value, meta, created_at)
     SELECT user_id, session_id, type, path, area, target, value, meta, created_at
     FROM jsonb_to_recordset($1::jsonb) AS x(
       user_id uuid, session_id text, type text, path text, area text, target text,
       value double precision, meta jsonb, created_at timestamptz
     )
     RETURNING id, type, area, path, target, created_at`,
    [JSON.stringify(rows)],
  )
  publish(inserted, userName)
}

/** Evento registrado pelo servidor (entrar, criar conta, pergunta ao assistente). Nunca derruba a requisição. */
export function recordServerEvent(userId: string, type: ServerEventType, target: string | null = null) {
  void pool
    .query<InsertedRow & { name: string; role: string }>(
      `WITH u AS (SELECT id, name, role FROM users WHERE id = $1)
       INSERT INTO usage_events (user_id, session_id, type, path, area, target)
       SELECT u.id, $2, $3, '', 'Conta', $4 FROM u WHERE u.role <> 'admin'
       RETURNING id, type, area, path, target, created_at, (SELECT name FROM u) AS name`,
      [userId, SERVER_SESSION, type, target],
    )
    .then(({ rows }) => rows[0] && publish(rows, rows[0].name))
    .catch((err) => console.error('Falha ao registrar evento de uso', err))
}

/** Dados de alguém mudaram (sincronização): o painel recalcula os números. */
export function notifyDataChanged() {
  liveBus.emit('changed')
}

const QUIET = new Set(['heartbeat', 'page_time'])

function publish(rows: InsertedRow[], userName: string | null) {
  const live: LiveEvent[] = rows
    .filter((r) => !QUIET.has(r.type))
    .map((r) => ({
      id: String(r.id),
      type: r.type,
      area: r.area,
      path: r.path,
      target: r.target,
      userName,
      at: r.created_at.toISOString(),
    }))
  if (live.length) liveBus.emit('live', live)
  else liveBus.emit('changed')
}
