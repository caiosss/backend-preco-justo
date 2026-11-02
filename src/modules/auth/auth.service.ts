import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { env } from '../../config/env.js'
import { pool } from '../../db/pool.js'
import { HttpError } from '../../utils/HttpError.js'
import { signToken } from '../../utils/jwt.js'
import { sendMail } from '../../utils/mail.js'

type UserRow = { id: string; name: string; email: string; password_hash: string; created_at: Date }

export type PublicUser = { id: string; name: string; email: string; createdAt: string }

const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  createdAt: u.created_at.toISOString(),
})

const session = (u: UserRow) => ({
  token: signToken({ sub: u.id, email: u.email }),
  user: toPublic(u),
})

export async function register(input: { name: string; email: string; password: string }) {
  const hash = await bcrypt.hash(input.password, 10)
  try {
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING *`,
      [input.name, input.email, hash],
    )
    return session(rows[0]!)
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'Já existe uma conta com este e-mail.')
    }
    throw err
  }
}

export async function login(input: { email: string; password: string }) {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE lower(email) = $1`, [
    input.email,
  ])
  const user = rows[0]
  const ok = user ? await bcrypt.compare(input.password, user.password_hash) : false
  if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos.')
  return session(user)
}

export async function findById(id: string): Promise<PublicUser> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id])
  if (!rows[0]) throw new HttpError(401, 'Conta não encontrada. Entre novamente.')
  return toPublic(rows[0])
}

/** Link de redefinir a senha vale 1 hora e só pode ser usado uma vez. */
const RESET_TTL_MS = 60 * 60 * 1000
/** Um e-mail a cada 2 minutos por conta, para ninguém lotar a caixa de entrada de outra pessoa. */
const RESET_COOLDOWN_MS = 2 * 60 * 1000

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/**
 * Pede a redefinição de senha. Responde igual exista ou não a conta,
 * para o formulário não revelar quais e-mails estão cadastrados.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE lower(email) = $1`, [email])
  const user = rows[0]
  if (!user) return

  const recent = await pool.query(
    `SELECT 1 FROM password_resets WHERE user_id = $1 AND created_at > now() - make_interval(secs => $2)`,
    [user.id, RESET_COOLDOWN_MS / 1000],
  )
  if (recent.rowCount) return

  const token = randomBytes(32).toString('hex')
  await pool.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    user.id,
    sha256(token),
    new Date(Date.now() + RESET_TTL_MS),
  ])

  const link = `${env.APP_URL.replace(/\/$/, '')}/redefinir-senha?token=${token}`
  const firstName = escapeHtml(user.name.split(' ')[0] ?? '')
  // Sem await: o tempo de resposta não pode denunciar que a conta existe
  void sendMail({
    to: user.email,
    subject: 'Redefinir sua senha do Preço Justo',
    text: `Olá, ${user.name.split(' ')[0]}!\n\nPara criar uma nova senha, abra o link abaixo (vale por 1 hora):\n${link}\n\nSe não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#1a2b22">
  <h2 style="color:#0f8a5a">Preço Justo</h2>
  <p>Olá, ${firstName}!</p>
  <p>Para criar uma nova senha, toque no botão abaixo. O link vale por 1 hora.</p>
  <p><a href="${link}" style="display:inline-block;background:#0f8a5a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Criar nova senha</a></p>
  <p style="font-size:13px;color:#5b6b62">Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>
</div>`,
  }).catch((err) => console.error('Falha ao enviar o e-mail de redefinir senha', err))
}

/** Troca a senha com o link do e-mail e já entra na conta. */
export async function resetPassword(input: { token: string; password: string }) {
  const hash = await bcrypt.hash(input.password, 10)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ user_id: string }>(
      `UPDATE password_resets SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [sha256(input.token)],
    )
    const reset = rows[0]
    if (!reset) throw new HttpError(400, 'Este link expirou ou já foi usado. Peça um novo.')

    const updated = await client.query<UserRow>(`UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *`, [
      hash,
      reset.user_id,
    ])
    // Os outros links pedidos antes deixam de valer
    await client.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [
      reset.user_id,
    ])
    await client.query('COMMIT')
    return session(updated.rows[0]!)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Troca a senha de quem já está conectado. Não pede a senha atual: é o caminho para quem esqueceu
 * e ainda tem a sessão aberta em algum aparelho (enquanto o e-mail de recuperação não está disponível).
 */
export async function changePassword(userId: string, password: string) {
  const hash = await bcrypt.hash(password, 10)
  const { rows } = await pool.query<UserRow>(`UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *`, [hash, userId])
  if (!rows[0]) throw new HttpError(401, 'Conta não encontrada. Entre novamente.')
  // Links de redefinir pedidos antes deixam de valer
  await pool.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId])
  return session(rows[0])
}
