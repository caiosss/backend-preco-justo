import { pool } from '../../db/pool.js'
import { COLLECTION_AREA, areaOf, screenOf } from '../events/areas.js'
import { SERVER_SESSION } from '../events/events.service.js'

/**
 * Números do painel do administrador. Duas fontes:
 * - o que o sistema já guardava: contas, negócios, cadastros e vendas (tabela backups) e a hora de cada
 *   mudança feita no app (clock dos dados), que mostra o histórico de uso desde o começo;
 * - os eventos de uso (usage_events): telas, tempo em cada área, cliques, erros, a partir desta versão.
 * A conta de administrador fica de fora de tudo.
 */

const TZ = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000

/** Áreas da barra de navegação, sempre listadas (mesmo sem uso) */
const NAV_AREAS = ['Início', 'Vendas', 'Produtos e serviços', 'Insumos', 'Despesas', 'Ajustes', 'Assistente']

const arr = (col: string) => `CASE WHEN jsonb_typeof(b.data->'${col}') = 'array' THEN b.data->'${col}' ELSE '[]'::jsonb END`
const len = (col: string) => `jsonb_array_length(${arr(col)})`
const jnum = (expr: string) => `CASE WHEN jsonb_typeof(${expr}) = 'number' THEN (${expr})::text::numeric ELSE 0 END`
const local = (col: string) => `(${col} AT TIME ZONE '${TZ}')`

/** Eventos do período, sem a conta de admin. $1 = início do período. */
const EV = `ev AS (
  SELECT e.* FROM usage_events e LEFT JOIN users eu ON eu.id = e.user_id
  WHERE e.created_at >= $1 AND coalesce(eu.role, 'user') <> 'admin'
)`

const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)

export const maskEmail = (email: string) => {
  const [user = '', domain = ''] = email.split('@')
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(user.length - 2, 1))}@${domain}`
}

type Q<T> = Promise<{ rows: T[] }>
const q = <T>(sql: string, params: unknown[] = []): Q<T> => pool.query(sql, params) as unknown as Q<T>

export async function getOverview(days: number) {
  const now = new Date()
  const dates = Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - (days - 1 - i) * DAY_MS)))
  const startDate = dates[0]!
  // Brasil sem horário de verão desde 2019: o dia começa às 00:00 -03:00
  const since = new Date(`${startDate}T00:00:00-03:00`)

  const [
    accounts,
    active,
    online,
    sales,
    salesDaily,
    signupsDaily,
    edits,
    eventsDaily,
    heat,
    areas,
    screens,
    topClicks,
    usability,
    counts,
    sessions,
    devices,
    flows,
    recent,
    topSupplies,
    feed,
    tracking,
  ] = await Promise.all([
    q<Record<string, number>>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE u.created_at >= $1)::int AS novas,
         count(*) FILTER (WHERE jsonb_typeof(b.data->'business') = 'object')::int AS com_negocio,
         count(*) FILTER (WHERE b.data->'business'->>'type' = 'producao')::int AS producao,
         count(*) FILTER (WHERE b.data->'business'->>'type' = 'servico')::int AS servico,
         count(*) FILTER (WHERE ${len('supplies')} > 0)::int AS com_insumo,
         count(*) FILTER (WHERE ${len('items')} > 0)::int AS com_item,
         count(*) FILTER (WHERE ${len('sales')} > 0)::int AS com_venda,
         coalesce(sum(${len('items')}), 0)::int AS itens,
         coalesce(sum(${len('supplies')}), 0)::int AS insumos,
         coalesce(sum(${len('expenses')} + ${len('tools')}), 0)::int AS despesas,
         coalesce(sum(${len('sales')}), 0)::int AS vendas
       FROM users u LEFT JOIN backups b ON b.user_id = u.id
       WHERE u.role <> 'admin'`,
      [since],
    ),
    q<{ periodo: number; dia: number; semana: number }>(
      `SELECT
         count(*) FILTER (WHERE last >= $1)::int AS periodo,
         count(*) FILTER (WHERE last >= now() - interval '1 day')::int AS dia,
         count(*) FILTER (WHERE last >= now() - interval '7 days')::int AS semana
       FROM (
         SELECT greatest(b.updated_at, ev.last, u.created_at) AS last
         FROM users u
         LEFT JOIN backups b ON b.user_id = u.id
         LEFT JOIN LATERAL (SELECT max(created_at) AS last FROM usage_events e WHERE e.user_id = u.id) ev ON true
         WHERE u.role <> 'admin'
       ) x`,
      [since],
    ),
    q<{ sessoes: number; pessoas: number }>(
      `SELECT count(DISTINCT e.session_id)::int AS sessoes, count(DISTINCT e.user_id)::int AS pessoas
       FROM usage_events e LEFT JOIN users eu ON eu.id = e.user_id
       WHERE e.created_at >= now() - interval '3 minutes' AND e.session_id <> '${SERVER_SESSION}'
         AND coalesce(eu.role, 'user') <> 'admin'`,
    ),
    q<Record<string, number>>(
      `SELECT
         count(*)::int AS registros_total,
         coalesce(sum(qty * price), 0)::float AS receita_total,
         count(*) FILTER (WHERE d >= $1)::int AS registros,
         coalesce(sum(qty) FILTER (WHERE d >= $1), 0)::float AS unidades,
         coalesce(sum(qty * price) FILTER (WHERE d >= $1), 0)::float AS receita,
         coalesce(sum(qty * (price - cost)) FILTER (WHERE d >= $1 AND cost IS NOT NULL), 0)::float AS sobra
       FROM (
         SELECT s->>'date' AS d, ${jnum("s->'qty'")} AS qty, ${jnum("s->'unitPrice'")} AS price,
           CASE WHEN jsonb_typeof(s->'unitCost') = 'number' THEN (s->'unitCost')::text::numeric END AS cost
         FROM backups b JOIN users u ON u.id = b.user_id AND u.role <> 'admin'
         CROSS JOIN LATERAL jsonb_array_elements(${arr('sales')}) s
       ) v`,
      [startDate],
    ),
    q<{ d: string; n: number; receita: number }>(
      `SELECT s->>'date' AS d, count(*)::int AS n, coalesce(sum(${jnum("s->'qty'")} * ${jnum("s->'unitPrice'")}), 0)::float AS receita
       FROM backups b JOIN users u ON u.id = b.user_id AND u.role <> 'admin'
       CROSS JOIN LATERAL jsonb_array_elements(${arr('sales')}) s
       WHERE s->>'date' >= $1
       GROUP BY 1`,
      [startDate],
    ),
    q<{ d: string; n: number }>(
      `SELECT to_char(${local('created_at')}, 'YYYY-MM-DD') AS d, count(*)::int AS n
       FROM users WHERE role <> 'admin' AND created_at >= $1 GROUP BY 1`,
      [since],
    ),
    q<{ col: string; d: string; dow: number; h: number; n: number }>(
      `SELECT split_part(c.key, ':', 1) AS col,
         to_char(${local('c.value::timestamptz')}, 'YYYY-MM-DD') AS d,
         extract(isodow FROM ${local('c.value::timestamptz')})::int AS dow,
         extract(hour FROM ${local('c.value::timestamptz')})::int AS h,
         count(*)::int AS n
       FROM backups b JOIN users u ON u.id = b.user_id AND u.role <> 'admin'
       CROSS JOIN LATERAL jsonb_each_text(
         CASE WHEN jsonb_typeof(b.data->'clock') = 'object' THEN b.data->'clock' ELSE '{}'::jsonb END
       ) c
       WHERE c.value ~ '^\\d{4}-\\d{2}-\\d{2}T' AND c.value::timestamptz >= $1
       GROUP BY 1, 2, 3, 4`,
      [since],
    ),
    q<{ d: string; views: number; clicks: number; sessoes: number; pessoas: number }>(
      `WITH ${EV}
       SELECT to_char(${local('created_at')}, 'YYYY-MM-DD') AS d,
         count(*) FILTER (WHERE type = 'page_view')::int AS views,
         count(*) FILTER (WHERE type = 'click')::int AS clicks,
         count(DISTINCT session_id) FILTER (WHERE session_id <> '${SERVER_SESSION}')::int AS sessoes,
         count(DISTINCT user_id)::int AS pessoas
       FROM ev GROUP BY 1`,
      [since],
    ),
    q<{ dow: number; h: number; n: number }>(
      `WITH ${EV}
       SELECT extract(isodow FROM ${local('created_at')})::int AS dow, extract(hour FROM ${local('created_at')})::int AS h,
         count(*)::int AS n
       FROM ev WHERE type IN ('page_view', 'click') GROUP BY 1, 2`,
      [since],
    ),
    q<{ area: string; views: number; clicks: number; ms: number; pessoas: number }>(
      `WITH ${EV}
       SELECT area,
         count(*) FILTER (WHERE type = 'page_view')::int AS views,
         count(*) FILTER (WHERE type = 'click')::int AS clicks,
         coalesce(sum(value) FILTER (WHERE type = 'page_time'), 0)::float AS ms,
         count(DISTINCT coalesce(user_id::text, session_id)) FILTER (WHERE type = 'page_view')::int AS pessoas
       FROM ev WHERE area NOT IN ('', 'Conta', 'Admin') GROUP BY area`,
      [since],
    ),
    q<{ path: string; views: number; ms: number }>(
      `WITH ${EV}
       SELECT path,
         count(*) FILTER (WHERE type = 'page_view')::int AS views,
         coalesce(sum(value) FILTER (WHERE type = 'page_time'), 0)::float AS ms
       FROM ev WHERE type IN ('page_view', 'page_time') AND area NOT IN ('', 'Admin')
       GROUP BY path`,
      [since],
    ),
    q<{ area: string; target: string; n: number; pessoas: number }>(
      `WITH ${EV}
       SELECT area, target, count(*)::int AS n, count(DISTINCT coalesce(user_id::text, session_id))::int AS pessoas
       FROM ev WHERE type = 'click' AND target IS NOT NULL AND area <> 'Admin'
       GROUP BY 1, 2 ORDER BY n DESC LIMIT 12`,
      [since],
    ),
    q<{ type: string; area: string; target: string; n: number; pessoas: number }>(
      `WITH ${EV}
       SELECT type, min(area) AS area, target, count(*)::int AS n, count(DISTINCT coalesce(user_id::text, session_id))::int AS pessoas
       FROM ev WHERE type IN ('rage_click', 'form_error', 'js_error', 'success') AND target IS NOT NULL
       GROUP BY type, target ORDER BY n DESC LIMIT 300`,
      [since],
    ),
    q<{ type: string; n: number }>(`WITH ${EV} SELECT type, count(*)::int AS n FROM ev GROUP BY type`, [since]),
    q<{ sessoes: number; duracao_ms: number | null; paginas: number | null; rejeicao: number }>(
      `WITH ${EV}
       SELECT count(*)::int AS sessoes,
         avg(dur) FILTER (WHERE dur > 0)::float AS duracao_ms,
         avg(pages)::float AS paginas,
         count(*) FILTER (WHERE pages <= 1)::int AS rejeicao
       FROM (
         SELECT session_id,
           extract(epoch FROM max(created_at) - min(created_at)) * 1000 AS dur,
           count(*) FILTER (WHERE type = 'page_view') AS pages
         FROM ev WHERE session_id <> '${SERVER_SESSION}'
         GROUP BY session_id
         HAVING count(*) FILTER (WHERE type = 'page_view') > 0
       ) s`,
      [since],
    ),
    q<{ device: string; pwa: boolean; n: number }>(
      `WITH ${EV}
       SELECT coalesce(meta->>'device', 'desconhecido') AS device, coalesce((meta->>'standalone')::boolean, false) AS pwa,
         count(*)::int AS n
       FROM ev WHERE type = 'session_start' GROUP BY 1, 2`,
      [since],
    ),
    q<{ de: string; para: string; n: number }>(
      `WITH ${EV}
       SELECT meta->>'fromPath' AS de, path AS para, count(*)::int AS n
       FROM ev WHERE type = 'page_view' AND meta ? 'fromPath' GROUP BY 1, 2`,
      [since],
    ),
    q<{
      name: string
      email: string
      created_at: Date
      last: Date | null
      negocio: string | null
      tipo: string | null
      itens: number
      insumos: number
      vendas: number
    }>(
      `SELECT u.name, u.email, u.created_at,
         greatest(b.updated_at, ev.last, u.created_at) AS last,
         b.data->'business'->>'name' AS negocio, b.data->'business'->>'type' AS tipo,
         coalesce(${len('items')}, 0)::int AS itens,
         coalesce(${len('supplies')}, 0)::int AS insumos,
         coalesce(${len('sales')}, 0)::int AS vendas
       FROM users u
       LEFT JOIN backups b ON b.user_id = u.id
       LEFT JOIN LATERAL (SELECT max(created_at) AS last FROM usage_events e WHERE e.user_id = u.id) ev ON true
       WHERE u.role <> 'admin'
       ORDER BY last DESC NULLS LAST LIMIT 15`,
    ),
    q<{ nome: string; contas: number; n: number }>(
      `SELECT lower(trim(s->>'name')) AS nome, count(DISTINCT b.user_id)::int AS contas, count(*)::int AS n
       FROM backups b JOIN users u ON u.id = b.user_id AND u.role <> 'admin'
       CROSS JOIN LATERAL jsonb_array_elements(${arr('supplies')}) s
       WHERE coalesce(trim(s->>'name'), '') <> ''
       GROUP BY 1 ORDER BY contas DESC, n DESC LIMIT 8`,
    ),
    q<{ id: string; type: string; area: string; path: string; target: string | null; created_at: Date; name: string | null }>(
      `SELECT e.id::text, e.type, e.area, e.path, e.target, e.created_at, eu.name
       FROM usage_events e LEFT JOIN users eu ON eu.id = e.user_id
       WHERE e.type NOT IN ('heartbeat', 'page_time') AND coalesce(eu.role, 'user') <> 'admin'
       ORDER BY e.id DESC LIMIT 30`,
    ),
    q<{ desde: Date | null; total: number }>(`SELECT min(created_at) AS desde, count(*)::int AS total FROM usage_events`),
  ])

  // ---- histórico vindo dos dados salvos (clock) ----
  const editsByArea = new Map<string, number>()
  const editsByDay = new Map<string, number>()
  const heatMap = new Map<string, { eventos: number; edicoes: number }>()
  const heatKey = (dow: number, h: number) => `${dow}-${h}`
  for (const r of edits.rows) {
    const area = COLLECTION_AREA[r.col] ?? 'Outras'
    editsByArea.set(area, (editsByArea.get(area) ?? 0) + r.n)
    editsByDay.set(r.d, (editsByDay.get(r.d) ?? 0) + r.n)
    const k = heatKey(r.dow, r.h)
    const cell = heatMap.get(k) ?? { eventos: 0, edicoes: 0 }
    cell.edicoes += r.n
    heatMap.set(k, cell)
  }
  for (const r of heat.rows) {
    const k = heatKey(r.dow, r.h)
    const cell = heatMap.get(k) ?? { eventos: 0, edicoes: 0 }
    cell.eventos += r.n
    heatMap.set(k, cell)
  }

  // ---- série diária ----
  const byDay = <T extends { d: string }>(rows: T[]) => new Map(rows.map((r) => [r.d, r]))
  const ev = byDay(eventsDaily.rows)
  const su = byDay(signupsDaily.rows)
  const sa = byDay(salesDaily.rows)
  const daily = dates.map((d) => ({
    date: d,
    cadastros: su.get(d)?.n ?? 0,
    edicoes: editsByDay.get(d) ?? 0,
    visualizacoes: ev.get(d)?.views ?? 0,
    cliques: ev.get(d)?.clicks ?? 0,
    sessoes: ev.get(d)?.sessoes ?? 0,
    pessoas: ev.get(d)?.pessoas ?? 0,
    vendas: sa.get(d)?.n ?? 0,
    receita: sa.get(d)?.receita ?? 0,
  }))

  // ---- áreas: uso medido (eventos) + mudanças salvas (histórico) ----
  const areaRows = new Map(areas.rows.map((r) => [r.area, r]))
  const areaNames = [...new Set([...NAV_AREAS, ...areaRows.keys(), ...editsByArea.keys()])].filter((a) => a !== 'Outras')
  const areaList = areaNames
    .map((area) => {
      const r = areaRows.get(area)
      return {
        area,
        visualizacoes: r?.views ?? 0,
        cliques: r?.clicks ?? 0,
        tempoMs: Math.round(r?.ms ?? 0),
        pessoas: r?.pessoas ?? 0,
        edicoes: editsByArea.get(area) ?? 0,
      }
    })
    .sort((a, b) => b.tempoMs - a.tempoMs || b.visualizacoes - a.visualizacoes || b.edicoes - a.edicoes)

  // ---- telas ----
  const screenMap = new Map<string, { tela: string; area: string; visualizacoes: number; tempoMs: number }>()
  for (const r of screens.rows) {
    const tela = screenOf(r.path)
    const cur = screenMap.get(tela) ?? { tela, area: areaOf(r.path), visualizacoes: 0, tempoMs: 0 }
    cur.visualizacoes += r.views
    cur.tempoMs += r.ms
    screenMap.set(tela, cur)
  }
  const telas = [...screenMap.values()]
    .map((t) => ({ ...t, tempoMs: Math.round(t.tempoMs), mediaMs: t.visualizacoes ? Math.round(t.tempoMs / t.visualizacoes) : 0 }))
    .sort((a, b) => b.tempoMs - a.tempoMs)
    .slice(0, 10)

  // ---- caminhos mais comuns entre áreas ----
  const flowMap = new Map<string, { de: string; para: string; n: number }>()
  for (const r of flows.rows) {
    const de = areaOf(r.de)
    const para = areaOf(r.para)
    if (de === para || de === 'Admin' || para === 'Admin') continue
    const k = `${de}→${para}`
    const cur = flowMap.get(k) ?? { de, para, n: 0 }
    cur.n += r.n
    flowMap.set(k, cur)
  }

  const countOf = (type: string) => counts.rows.find((c) => c.type === type)?.n ?? 0
  const top = (type: string, n = 6) =>
    usability.rows
      .filter((r) => r.type === type)
      .slice(0, n)
      .map((r) => ({ texto: r.target, area: r.area, vezes: r.n, pessoas: r.pessoas }))

  const s = sessions.rows[0]
  const a = accounts.rows[0]!

  return {
    generatedAt: now.toISOString(),
    days,
    timezone: TZ,
    tracking: { desde: tracking.rows[0]?.desde?.toISOString() ?? null, eventos: tracking.rows[0]?.total ?? 0 },
    online: online.rows[0] ?? { sessoes: 0, pessoas: 0 },
    contas: {
      total: a.total ?? 0,
      novas: a.novas ?? 0,
      ativas24h: active.rows[0]?.dia ?? 0,
      ativas7d: active.rows[0]?.semana ?? 0,
      ativasPeriodo: active.rows[0]?.periodo ?? 0,
      comNegocio: a.com_negocio ?? 0,
      producao: a.producao ?? 0,
      servico: a.servico ?? 0,
    },
    cadastros: { itens: a.itens ?? 0, insumos: a.insumos ?? 0, despesas: a.despesas ?? 0, vendas: a.vendas ?? 0 },
    funil: [
      { etapa: 'Criou a conta', contas: a.total ?? 0 },
      { etapa: 'Cadastrou o negócio', contas: a.com_negocio ?? 0 },
      { etapa: 'Cadastrou um insumo', contas: a.com_insumo ?? 0 },
      { etapa: 'Cadastrou um produto/serviço', contas: a.com_item ?? 0 },
      { etapa: 'Registrou uma venda', contas: a.com_venda ?? 0 },
    ],
    vendas: sales.rows[0] ?? {},
    uso: {
      sessoes: s?.sessoes ?? 0,
      duracaoMediaMs: Math.round(s?.duracao_ms ?? 0),
      paginasPorSessao: s?.paginas ?? 0,
      rejeicao: s?.rejeicao ?? 0,
      visualizacoes: countOf('page_view'),
      cliques: countOf('click'),
      logins: countOf('login'),
      contasCriadas: countOf('register'),
      senhasTrocadas: countOf('password_reset'),
      perguntasAssistente: countOf('assistant_question'),
      cliquesRepetidos: countOf('rage_click'),
      errosFormulario: countOf('form_error'),
      errosApp: countOf('js_error'),
      acoesConcluidas: countOf('success'),
    },
    daily,
    areas: areaList,
    telas,
    botoes: topClicks.rows.map((r) => ({ area: r.area, texto: r.target, vezes: r.n, pessoas: r.pessoas })),
    usabilidade: {
      cliquesRepetidos: top('rage_click'),
      errosFormulario: top('form_error'),
      errosApp: top('js_error', 5),
      acoes: top('success', 8),
    },
    caminhos: [...flowMap.values()].sort((x, y) => y.n - x.n).slice(0, 8),
    heatmap: [...heatMap.entries()].map(([k, v]) => {
      const [dow, h] = k.split('-').map(Number)
      return { dow: dow!, h: h!, ...v }
    }),
    dispositivos: devices.rows,
    insumosMaisUsados: topSupplies.rows,
    contasRecentes: recent.rows.map((r) => ({
      nome: r.name,
      email: maskEmail(r.email),
      criadaEm: r.created_at.toISOString(),
      ultimaAtividade: r.last?.toISOString() ?? null,
      negocio: r.negocio,
      tipo: r.tipo,
      itens: r.itens,
      insumos: r.insumos,
      vendas: r.vendas,
    })),
    feed: feed.rows.map((r) => ({
      id: r.id,
      type: r.type,
      area: r.area,
      path: r.path,
      target: r.target,
      userName: r.name,
      at: r.created_at.toISOString(),
    })),
  }
}

export type Overview = Awaited<ReturnType<typeof getOverview>>
