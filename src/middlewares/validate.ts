import type { z } from 'zod'
import { HttpError } from '../utils/HttpError.js'

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) {
    const first = result.error.issues[0]
    throw new HttpError(400, first?.message ?? 'Dados inválidos.', result.error.issues)
  }
  return result.data
}
