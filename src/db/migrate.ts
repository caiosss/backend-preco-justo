import { pool } from './pool.js'

/**
 * Migrações simples e idempotentes, executadas ao subir a API.
 * Cada item roda uma única vez e fica registrado em schema_migrations.
 */
const migrations: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name          text NOT NULL,
        email         text NOT NULL,
        password_hash text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

      CREATE TABLE IF NOT EXISTS backups (
        user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data              jsonb NOT NULL,
        client_updated_at timestamptz NOT NULL,
        updated_at        timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
]

export async function migrate(retries = 10): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1')
      break
    } catch (err) {
      if (attempt >= retries) throw err
      console.log(`Aguardando o Postgres... (${attempt}/${retries})`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id     text PRIMARY KEY,
        run_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations')
    const done = new Set(rows.map((r) => r.id))

    for (const m of migrations) {
      if (done.has(m.id)) continue
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id])
        await client.query('COMMIT')
        console.log(`✔ Migração aplicada: ${m.id}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    client.release()
  }
}
