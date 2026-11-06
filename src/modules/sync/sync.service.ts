import { pool } from '../../db/pool.js'
import { notifyDataChanged } from '../events/events.service.js'
import { mergeDocs, type SyncDoc } from './merge.js'

/** Dados da conta, compartilhados por todos os aparelhos em que ela entra. */
export type AccountData = { data: SyncDoc; revision: number; savedAt: string }

type Row = { data: SyncDoc; revision: string; updated_at: Date }

/** JSON com as chaves em ordem: o jsonb do Postgres não guarda a ordem original das chaves. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v)

const toAccountData =(row: Row): AccountData => ({
  data: row.data,
  revision: Number(row.revision),
  savedAt: row.updated_at.toISOString(),
})

export async function getAccountData(userId: string): Promise<AccountData | null> {
  const { rows } = await pool.query<Row>(`SELECT data, revision, updated_at FROM backups WHERE user_id = $1`, [userId])
  return rows[0] ? toAccountData(rows[0]) : null
}

export async function getRevision(userId: string): Promise<number | null> {
  const { rows } = await pool.query<{ revision: string }>(`SELECT revision FROM backups WHERE user_id = $1`, [userId])
  return rows[0] ? Number(rows[0].revision) : null
}

/**
 * Junta o que o aparelho mandou com o que já está na conta e grava.
 * A linha fica travada durante a junção: dois aparelhos sincronizando juntos não se atropelam.
 */
export async function mergeAndSave(userId: string, incoming: SyncDoc, firstSync: boolean): Promise<AccountData> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<Row>(
      `SELECT data, revision, updated_at FROM backups WHERE user_id = $1 FOR UPDATE`,
      [userId],
    )
    const current = rows[0]
    const merged = mergeDocs(current?.data ?? null, incoming, { firstSync })

    let saved: Row
    if (current && stable(merged) === stable(current.data)) {
      // Nada mudou: mantém a revisão para os outros aparelhos não baixarem tudo de novo
      saved = current
    } else {
      const result = await client.query<Row>(
        `INSERT INTO backups (user_id, data, client_updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
           SET data = EXCLUDED.data,
               client_updated_at = EXCLUDED.client_updated_at,
               revision = backups.revision + 1,
               updated_at = now()
         RETURNING data, revision, updated_at`,
        [userId, JSON.stringify(merged), merged.updatedAt],
      )
      saved = result.rows[0]!
    }
    await client.query('COMMIT')
    if (saved !== current) notifyDataChanged()
    return toAccountData(saved)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
