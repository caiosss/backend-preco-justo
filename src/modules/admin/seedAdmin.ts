import bcrypt from 'bcryptjs'
import { env } from '../../config/env.js'
import { pool } from '../../db/pool.js'

/** Hash bcrypt da senha inicial combinada no projeto (a senha em si não fica no código). */
const DEFAULT_ADMIN_HASH = '$2b$10$Fm1JPxGmwZJaUkUJikyPKeeEYuUyJce.MP2efWY//B2CWYAFA9Iy.'

/**
 * Garante a conta de administrador ao subir a API.
 * - não existe: cria com a senha de ADMIN_PASSWORD (ou a inicial);
 * - existe como conta comum (alguém cadastrou o e-mail antes): vira admin e a senha volta a ser a configurada,
 *   para quem cadastrou o e-mail não herdar o acesso ao painel;
 * - com ADMIN_PASSWORD definida, a senha do admin acompanha a variável.
 */
export async function ensureAdmin(): Promise<void> {
  const email = env.ADMIN_EMAIL.toLowerCase()
  const hash = env.ADMIN_PASSWORD ? await bcrypt.hash(env.ADMIN_PASSWORD, 10) : DEFAULT_ADMIN_HASH

  const { rows } = await pool.query<{ id: string; role: string; password_hash: string }>(
    `SELECT id, role, password_hash FROM users WHERE lower(email) = $1`,
    [email],
  )
  const current = rows[0]
  if (!current) {
    await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ('Administrador', $1, $2, 'admin')`, [
      email,
      hash,
    ])
    console.log(`✔ Conta de administrador criada: ${email}`)
    return
  }
  const passwordDrift = env.ADMIN_PASSWORD ? !(await bcrypt.compare(env.ADMIN_PASSWORD, current.password_hash)) : false
  if (current.role !== 'admin' || passwordDrift) {
    await pool.query(`UPDATE users SET role = 'admin', password_hash = $2 WHERE id = $1`, [current.id, hash])
    console.log(`✔ Conta de administrador atualizada: ${email}`)
  }
}
