import { type Request, Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../../config/env.js'
import { requireAuth, userIdOf } from '../../middlewares/auth.js'
import { HttpError } from '../../utils/HttpError.js'

/**
 * Assistente de IA: repassa a pergunta ao serviço do agente (repo agente-preco-justo) pela rede
 * privada. O contrato do corpo e da resposta está no README de lá; quem valida o corpo é o agente.
 * Aqui ficam o login e os limites de uso, que seguram o gasto com o modelo.
 */
export const agentRoutes = Router()

const DIA = 24 * 60 * 60 * 1000
const INDISPONIVEL = 'O assistente está indisponível agora. Tente de novo em alguns minutos.'

const porPessoa = (req: Request) => userIdOf(req)

// shortcut: contadores em memória; zeram no redeploy e valem por réplica. Ir para o Postgres se escalar.
const limite = (windowMs: number, limit: number, error: string, keyGenerator: (req: Request) => string) =>
  rateLimit({ windowMs, limit, keyGenerator, standardHeaders: 'draft-8', legacyHeaders: false, message: { error } })

agentRoutes.post(
  '/chat',
  requireAuth,
  limite(60 * 1000, 5, 'Você fez muitas perguntas seguidas. Espere um minuto.', porPessoa),
  limite(DIA, 30, 'Você chegou ao limite de perguntas de hoje. Volte amanhã.', porPessoa),
  // O cadastro é aberto: sem um teto para todos juntos, contas novas multiplicariam o gasto
  limite(DIA, env.AGENT_DAILY_LIMIT, 'O assistente atingiu o limite de perguntas de hoje. Tente de novo amanhã.', () => 'todos'),
  async (req, res) => {
    if (!env.AGENT_URL || !env.AGENT_KEY) throw new HttpError(503, INDISPONIVEL)

    let resposta: Response
    try {
      resposta = await fetch(`${env.AGENT_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Key': env.AGENT_KEY },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(65_000), // o agente desiste em 60 s
      })
    } catch {
      throw new HttpError(503, INDISPONIVEL)
    }
    if (resposta.status >= 500) throw new HttpError(503, INDISPONIVEL)

    // 2xx e 4xx (corpo inválido, sem consentimento) seguem com a mensagem do agente
    const corpo: unknown = await resposta.json().catch(() => {
      throw new HttpError(503, INDISPONIVEL)
    })
    res.status(resposta.status).json(corpo)
  },
)
