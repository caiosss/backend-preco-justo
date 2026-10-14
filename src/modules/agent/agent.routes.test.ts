import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, test } from 'node:test'

const AGENT_KEY = 'chave-do-agente-de-teste-'.padEnd(40, 'x')
const INDISPONIVEL = 'O assistente está indisponível agora. Tente de novo em alguns minutos.'
const PERGUNTA = { consentimento: true, contexto: { tipo: 'servico' }, pergunta: 'posso baixar o buço?' }
const RESPOSTA = { resposta: 'Pode, até **R$ 12,41**.', propostas: [], acoes: [] }

// Agente falso (o serviço Python): cada teste define como ele responde
type Comportamento = { status: number; body: unknown } | 'derrubar'
let comportamento: Comportamento = { status: 200, body: RESPOSTA }
const recebidos: { chave: string | undefined; corpo: unknown }[] = []

let agente: Server
let api: Server
let url: string
let signToken: (typeof import('../../utils/jwt.js'))['signToken']

before(async () => {
  agente = createServer(async (req, res) => {
    let texto = ''
    for await (const parte of req) texto += parte
    recebidos.push({ chave: req.headers['x-agent-key'] as string | undefined, corpo: JSON.parse(texto) })
    if (comportamento === 'derrubar') return void req.socket.destroy()
    res.writeHead(comportamento.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(comportamento.body))
  })
  agente.listen(0, '127.0.0.1')
  await once(agente, 'listening')

  // env.ts valida as variáveis no import: elas precisam existir antes de carregar o app
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://teste:teste@127.0.0.1:1/teste', // a rota do agente não usa o banco
    JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
    AGENT_URL: `http://127.0.0.1:${(agente.address() as AddressInfo).port}`,
    AGENT_KEY,
    AGENT_DAILY_LIMIT: '12',
  })
  const { app } = await import('../../app.js')
  ;({ signToken } = await import('../../utils/jwt.js'))
  api = app.listen(0, '127.0.0.1')
  await once(api, 'listening')
  url = `http://127.0.0.1:${(api.address() as AddressInfo).port}/api/agent/chat`
})

after(() => {
  api.close()
  agente.close()
})

function perguntar(usuario: string | null) {
  const login = usuario ? { Authorization: `Bearer ${signToken({ sub: usuario, email: `${usuario}@teste.com` })}` } : {}
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...login },
    body: JSON.stringify(PERGUNTA),
  })
}

describe('POST /api/agent/chat', () => {
  test('sem login é 401 e não chama o agente', async () => {
    const antes = recebidos.length
    const r = await perguntar(null)
    assert.equal(r.status, 401)
    assert.equal(recebidos.length, antes)
  })

  test('repassa o corpo ao agente com a chave e devolve a resposta dele', async () => {
    comportamento = { status: 200, body: RESPOSTA }
    const r = await perguntar('u-repasse')
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), RESPOSTA)
    assert.deepEqual(recebidos.at(-1), { chave: AGENT_KEY, corpo: PERGUNTA })
  })

  test('erro 4xx do agente volta com a mensagem dele', async () => {
    const semConsentimento = { error: 'Para usar o assistente, autorize o envio dos dados da sua ficha.' }
    comportamento = { status: 403, body: semConsentimento }
    const r = await perguntar('u-consentimento')
    assert.equal(r.status, 403)
    assert.deepEqual(await r.json(), semConsentimento)
  })

  test('erro 5xx do agente vira 503 com mensagem amigável', async () => {
    comportamento = { status: 500, body: { error: 'Internal Server Error' } }
    const r = await perguntar('u-erro')
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: INDISPONIVEL })
  })

  test('agente fora do ar vira 503 com mensagem amigável', async () => {
    comportamento = 'derrubar'
    const r = await perguntar('u-fora')
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { error: INDISPONIVEL })
  })

  test('limita 5 perguntas por minuto por pessoa, sem afetar as outras', async () => {
    comportamento = { status: 200, body: RESPOSTA }
    for (let i = 0; i < 5; i++) assert.equal((await perguntar('u-minuto')).status, 200)
    const sexta = await perguntar('u-minuto')
    assert.equal(sexta.status, 429)
    assert.deepEqual(await sexta.json(), { error: 'Você fez muitas perguntas seguidas. Espere um minuto.' })
    assert.equal((await perguntar('u-outra-pessoa')).status, 200)
  })

  test('o limite global do dia vale para todas as pessoas juntas', async () => {
    comportamento = { status: 200, body: RESPOSTA }
    const global = { error: 'O assistente atingiu o limite de perguntas de hoje. Tente de novo amanhã.' }
    let bloqueio: Response | undefined
    for (let i = 0; i < 20 && !bloqueio; i++) {
      const r = await perguntar(`u-global-${i}`)
      if (r.status === 429) bloqueio = r
    }
    assert.ok(bloqueio, 'o limite global (AGENT_DAILY_LIMIT=12) deveria ter bloqueado')
    assert.deepEqual(await bloqueio.json(), global)
    const novaPessoa = await perguntar('u-nunca-perguntou')
    assert.equal(novaPessoa.status, 429)
    assert.deepEqual(await novaPessoa.json(), global)
  })
})
