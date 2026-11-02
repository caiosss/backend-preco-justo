import { Router } from 'express'
import { pool } from '../../db/pool.js'
import { requireAuth, userIdOf } from '../../middlewares/auth.js'
import { parseBody } from '../../middlewares/validate.js'
import { mergeAndSave } from '../sync/sync.service.js'
import { putBackupSchema } from './backup.schemas.js'

/**
 * Rotas do backup das versões antigas do app (antes da sincronização entre aparelhos).
 * Ficam no ar enquanto houver celular sem atualizar; o app novo usa /api/sync.
 */
export const backupRoutes = Router()

backupRoutes.use(requireAuth)

type BackupRow = { data: unknown; client_updated_at: Date; updated_at: Date }

backupRoutes.get('/', async (req, res) => {
  const { rows } = await pool.query<BackupRow>(
    `SELECT data, client_updated_at, updated_at FROM backups WHERE user_id = $1`,
    [userIdOf(req)],
  )
  const row = rows[0]
  if (!row) {
    res.json({ backup: null })
    return
  }
  res.json({
    backup: {
      data: row.data,
      dataUpdatedAt: row.client_updated_at.toISOString(),
      savedAt: row.updated_at.toISOString(),
    },
  })
})

// Versões antigas do app ainda mandam o backup inteiro: junta com o que veio dos outros aparelhos
backupRoutes.put('/', async (req, res) => {
  const { data } = parseBody(putBackupSchema, req.body)
  // A versão antiga não sabe o que veio dos outros aparelhos: é sempre um primeiro encontro
  const { savedAt } = await mergeAndSave(userIdOf(req), data, true)
  res.json({ savedAt })
})

backupRoutes.delete('/', async (req, res) => {
  await pool.query(`DELETE FROM backups WHERE user_id = $1`, [userIdOf(req)])
  res.status(204).end()
})
