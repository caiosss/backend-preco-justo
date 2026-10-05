import { Router } from 'express'
import { pool } from '../../db/pool.js'
import { requireAuth, userIdOf } from '../../middlewares/auth.js'
import { parseBody } from '../../middlewares/validate.js'
import { putBackupSchema } from './backup.schemas.js'

/**
 * Backup opcional na nuvem. Os dados vivem no aparelho do empreendedor (RNF06);
 * o app só envia para cá quando ele liga o backup explicitamente.
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

backupRoutes.put('/', async (req, res) => {
  const { data } = parseBody(putBackupSchema, req.body)
  const { rows } = await pool.query<{ updated_at: Date }>(
    `INSERT INTO backups (user_id, data, client_updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET data = EXCLUDED.data,
           client_updated_at = EXCLUDED.client_updated_at,
           updated_at = now()
     RETURNING updated_at`,
    [userIdOf(req), JSON.stringify(data), data.updatedAt],
  )
  res.json({ savedAt: rows[0]!.updated_at.toISOString() })
})

backupRoutes.delete('/', async (req, res) => {
  await pool.query(`DELETE FROM backups WHERE user_id = $1`, [userIdOf(req)])
  res.status(204).end()
})
