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
  {
    // A cópia na nuvem deixa de ser opcional e vira os dados da conta, compartilhados entre aparelhos.
    // revision muda a cada gravação: o app só baixa tudo de novo quando ela mudou.
    id: '002_sync_e_recuperar_senha',
    sql: `
      ALTER TABLE backups ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS password_resets (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        used_at    timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id, created_at DESC);
    `,
  },
  {
    // Cópia dos dados como estavam antes da primeira junção entre aparelhos, para conferência.
    // Roda antes da API aceitar requisições. Pode ser apagada quando todos estiverem sincronizando bem.
    id: '003_copia_antes_do_sync',
    sql: `CREATE TABLE IF NOT EXISTS backups_antes_do_sync AS SELECT * FROM backups;`,
  },
  {
    // Conta de administrador (painel de uso) e os eventos de uso do app que alimentam o painel.
    // Os eventos não guardam nada digitado: só a tela, o botão tocado e mensagens de erro do próprio app.
    id: '004_admin_e_eventos_de_uso',
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

      CREATE TABLE IF NOT EXISTS usage_events (
        id         bigserial PRIMARY KEY,
        user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
        session_id text NOT NULL,
        type       text NOT NULL,
        path       text NOT NULL DEFAULT '',
        area       text NOT NULL DEFAULT '',
        target     text,
        value      double precision,
        meta       jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS usage_events_created ON usage_events (created_at DESC);
      CREATE INDEX IF NOT EXISTS usage_events_type_created ON usage_events (type, created_at DESC);
      CREATE INDEX IF NOT EXISTS usage_events_session ON usage_events (session_id, created_at);
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
