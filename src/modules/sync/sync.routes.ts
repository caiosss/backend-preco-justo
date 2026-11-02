import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, userIdOf } from '../../middlewares/auth.js'
import { parseBody } from '../../middlewares/validate.js'
import { putBackupSchema } from '../backup/backup.schemas.js'
import { getAccountData, getRevision, mergeAndSave } from './sync.service.js'

/**
 * Sincronização dos dados da conta entre aparelhos.
 * O app continua funcionando offline: os dados ficam no aparelho e são juntados aqui quando há internet.
 */
export const syncRoutes = Router()

// firstSync: o aparelho nunca recebeu os dados da conta (aparelho novo ou recém-atualizado)
const syncSchema = putBackupSchema.extend({ firstSync: z.boolean().default(false) })

syncRoutes.use(requireAuth)

/** Só a revisão: o app consulta com frequência e baixa tudo apenas quando ela mudou. */
syncRoutes.get('/revision', async (req, res) => {
  res.json({ revision: await getRevision(userIdOf(req)) })
})

syncRoutes.get('/', async (req, res) => {
  res.json({ account: await getAccountData(userIdOf(req)) })
})

/** Envia os dados do aparelho e recebe de volta a versão juntada com os outros aparelhos. */
syncRoutes.post('/', async (req, res) => {
  const { data, firstSync } = parseBody(syncSchema, req.body)
  res.json({ account: await mergeAndSave(userIdOf(req), data, firstSync) })
})
