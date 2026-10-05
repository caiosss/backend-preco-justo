import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth, userIdOf } from '../../middlewares/auth.js'
import { parseBody } from '../../middlewares/validate.js'
import { loginSchema, registerSchema } from './auth.schemas.js'
import * as auth from './auth.service.js'

export const authRoutes = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' },
})

authRoutes.post('/register', authLimiter, async (req, res) => {
  const input = parseBody(registerSchema, req.body)
  res.status(201).json(await auth.register(input))
})

authRoutes.post('/login', authLimiter, async (req, res) => {
  const input = parseBody(loginSchema, req.body)
  res.json(await auth.login(input))
})

authRoutes.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await auth.findById(userIdOf(req)) })
})
