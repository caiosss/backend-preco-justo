/**
 * Junta os dados de dois aparelhos da mesma conta.
 *
 * Cada registro tem a hora da última mudança em `clock` ("items:<id>", "business", "dismissedTips")
 * e cada exclusão fica em `deleted` ("items:<id>"). Em conflito vence a mudança mais recente.
 *
 * Dados de versões antigas do app não têm `clock`: nesse caso a hora do registro é o `updatedAt`
 * do pacote inteiro. É assim que o celular e o PC que nunca sincronizaram viram uma loja só:
 * os registros de cada lado têm ids diferentes e simplesmente se somam.
 *
 * Na primeira vez que um aparelho sincroniza (`firstSync`), os dois lados nunca se viram, então a hora
 * não diz qual negócio é o "de verdade": vale o lado com mais coisa cadastrada. Assim o cadastro de teste
 * feito num PC novo não sobrescreve o negócio que já está em uso no celular.
 */

export const COLLECTIONS = ['supplies', 'expenses', 'tools', 'items', 'sales'] as const

type Entity = { id: string; [k: string]: unknown }

export type SyncDoc = {
  version: number
  business: Record<string, unknown> | null
  supplies: Entity[]
  expenses: Entity[]
  tools: Entity[]
  items: Entity[]
  sales: Entity[]
  dismissedTips: string[]
  updatedAt: string
  clock?: Record<string, string>
  deleted?: Record<string, string>
  [k: string]: unknown
}

/** Exclusões mais antigas que isso são esquecidas (todo aparelho ativo já sincronizou). */
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000

const EPOCH = new Date(0).toISOString()
const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b)
const isAfter = (a: string, b: string) => Date.parse(a) > Date.parse(b)

/** Hora da última mudança do registro; sem relógio, vale a data do pacote (dado legado). */
const stampOf = (doc: SyncDoc, key: string) => doc.clock?.[key] ?? doc.updatedAt ?? EPOCH
const hasStamp = (doc: SyncDoc, key: string) => typeof doc.clock?.[key] === 'string'
const latest = (dates: (string | undefined)[]) =>
  dates.filter((d): d is string => typeof d === 'string').reduce<string | null>((max, d) => (max ? later(max, d) : d), null)

const dataSize = (doc: SyncDoc) => COLLECTIONS.reduce((n, c) => n + doc[c].length, 0)

/** Preenche o relógio que faltar, para que só a primeira sincronização dependa do updatedAt. */
export function normalize(doc: SyncDoc, now = new Date()): SyncDoc {
  const clock: Record<string, string> = { ...doc.clock }
  for (const c of COLLECTIONS) {
    for (const e of doc[c]) clock[`${c}:${e.id}`] ??= doc.updatedAt
  }
  if (doc.business) clock.business ??= doc.updatedAt
  clock.dismissedTips ??= doc.updatedAt

  const cutoff = now.getTime() - TOMBSTONE_TTL_MS
  const deleted = Object.fromEntries(
    Object.entries(doc.deleted ?? {}).filter(([key, at]) => Date.parse(at) >= cutoff && !(key in clock)),
  )
  return { ...doc, clock, deleted }
}

function mergeCollection(
  name: (typeof COLLECTIONS)[number],
  server: SyncDoc,
  incoming: SyncDoc,
  clock: Record<string, string>,
  deleted: Record<string, string>,
): Entity[] {
  const fromServer = new Map(server[name].map((e) => [e.id, e]))
  const fromIncoming = new Map(incoming[name].map((e) => [e.id, e]))
  // Ordem: a do servidor e, no fim, o que só existe no aparelho
  const ids = [...new Set([...fromServer.keys(), ...fromIncoming.keys()])]
  // Exclusões de registros que nenhum lado tem mais continuam valendo para os aparelhos que ainda não souberam
  const prefix = `${name}:`
  for (const key of new Set([...Object.keys(server.deleted ?? {}), ...Object.keys(incoming.deleted ?? {})])) {
    const id = key.slice(prefix.length)
    if (key.startsWith(prefix) && !fromServer.has(id) && !fromIncoming.has(id)) {
      deleted[key] = latest([server.deleted?.[key], incoming.deleted?.[key]])!
    }
  }
  const out: Entity[] = []

  for (const id of ids) {
    const key = `${name}:${id}`
    const s = fromServer.get(id)
    const i = fromIncoming.get(id)

    let value: Entity | undefined
    let at = EPOCH
    if (s) [value, at] = [s, stampOf(server, key)]
    // Empate fica com o aparelho, que é quem está vendo o dado agora
    if (i && !isAfter(at, stampOf(incoming, key))) [value, at] = [i, stampOf(incoming, key)]

    const removedAt = latest([server.deleted?.[key], incoming.deleted?.[key]])

    if (value && !(removedAt && !isAfter(at, removedAt))) {
      out.push(value)
      clock[key] = at
    } else if (removedAt) {
      deleted[key] = removedAt
    }
  }
  return out
}

/** Escolhe o cadastro do negócio. O de um aparelho novo, ainda sem nada, não apaga o de quem já usa o app. */
function pickBusiness(server: SyncDoc, incoming: SyncDoc, clock: Record<string, string>, firstSync: boolean) {
  const s = server.business
  const i = incoming.business
  if (!s || !i) {
    const only = s ? server : incoming
    if (only.business) clock.business = stampOf(only, 'business')
    return only.business
  }

  let winner: SyncDoc
  if (!firstSync && hasStamp(server, 'business') && hasStamp(incoming, 'business')) {
    winner = isAfter(stampOf(server, 'business'), stampOf(incoming, 'business')) ? server : incoming
  } else {
    // Primeiro encontro dos dois lados (ou dado de versão antiga): vale quem tem mais coisa cadastrada
    const diff = dataSize(server) - dataSize(incoming)
    winner = diff > 0 ? server : diff < 0 ? incoming : isAfter(server.updatedAt, incoming.updatedAt) ? server : incoming
  }
  clock.business = stampOf(winner, 'business')
  return winner.business
}

function pickTips(server: SyncDoc, incoming: SyncDoc, clock: Record<string, string>) {
  if (hasStamp(server, 'dismissedTips') && hasStamp(incoming, 'dismissedTips')) {
    const s = stampOf(server, 'dismissedTips')
    const i = stampOf(incoming, 'dismissedTips')
    const winner = isAfter(s, i) ? server : incoming
    clock.dismissedTips = later(s, i)
    return winner.dismissedTips
  }
  clock.dismissedTips = later(stampOf(server, 'dismissedTips'), stampOf(incoming, 'dismissedTips'))
  return [...new Set([...server.dismissedTips, ...incoming.dismissedTips])]
}

/** Junta o que está no servidor com o que chegou do aparelho. Sem nada no servidor, vale o do aparelho. */
export function mergeDocs(
  server: SyncDoc | null,
  incoming: SyncDoc,
  { now = new Date(), firstSync = false }: { now?: Date; firstSync?: boolean } = {},
): SyncDoc {
  if (!server) return normalize(incoming, now)

  const clock: Record<string, string> = {}
  const deleted: Record<string, string> = {}
  const merged: SyncDoc = {
    // Campos desconhecidos (versões futuras do app) seguem o pacote mais recente
    ...(isAfter(server.updatedAt, incoming.updatedAt) ? { ...incoming, ...server } : { ...server, ...incoming }),
    version: Math.max(server.version, incoming.version),
    business: pickBusiness(server, incoming, clock, firstSync),
    dismissedTips: pickTips(server, incoming, clock),
    updatedAt: later(server.updatedAt, incoming.updatedAt),
  }
  for (const c of COLLECTIONS) merged[c] = mergeCollection(c, server, incoming, clock, deleted)
  return normalize({ ...merged, clock, deleted }, now)
}
