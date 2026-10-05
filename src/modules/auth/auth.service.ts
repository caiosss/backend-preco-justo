import bcrypt from 'bcryptjs'
import { pool } from '../../db/pool.js'
import { HttpError } from '../../utils/HttpError.js'
import { signToken } from '../../utils/jwt.js'

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
