import type { NextFunction, Request, Response } from 'express'
import { pool } from '../db/pool.js'
import { HttpError } from '../utils/HttpError.js'
import { verifyToken } from '../utils/jwt.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Faça login para continuar.')
  }
  try {
    req.userId = verifyToken(header.slice(7)).sub
    next()
  } catch {
    throw new HttpError(401, 'Sua sessão expirou. Entre novamente.')
  }
}

/** Garante o userId preenchido pelo requireAuth. */
export function userIdOf(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Faça login para continuar.')
  return req.userId
}

/** Lê o login se houver; sem login (ou com token vencido) a requisição segue como anônima. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      req.userId = verifyToken(header.slice(7)).sub
    } catch {
      /* segue anônimo */
    }
  }
  next()
}

/** Só a conta de administrador. O papel é conferido no banco a cada pedido, não no token. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => undefined)
  const { rows } = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [userIdOf(req)])
  if (rows[0]?.role !== 'admin') throw new HttpError(403, 'Esta área é só para o administrador.')
  next()
}
