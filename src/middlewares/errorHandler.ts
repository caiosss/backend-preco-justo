import type { ErrorRequestHandler, RequestHandler } from 'express'
import { HttpError } from '../utils/HttpError.js'

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' })
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Os dados enviados são grandes demais.' })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'JSON inválido.' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' })
}
