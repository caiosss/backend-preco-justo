import type { NextFunction, Request, Response } from 'express'
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
