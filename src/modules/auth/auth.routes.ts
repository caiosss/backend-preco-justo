import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requireAuth, userIdOf } from '../../middlewares/auth.js'
import { parseBody } from '../../middlewares/validate.js'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  resetByEmailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas.js'
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

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitos pedidos. Aguarde alguns minutos e tente de novo.' },
})

authRoutes.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = parseBody(forgotPasswordSchema, req.body)
  await auth.requestPasswordReset(email)
  res.json({ ok: true })
})

// Sem e-mail disponível: troca a senha direto pelo e-mail da conta (ver resetPasswordByEmail)
authRoutes.post('/reset-password-direct', forgotLimiter, async (req, res) => {
  const input = parseBody(resetByEmailSchema, req.body)
  res.json(await auth.resetPasswordByEmail(input))
})

authRoutes.post('/reset-password', authLimiter, async (req, res) => {
  const input = parseBody(resetPasswordSchema, req.body)
  res.json(await auth.resetPassword(input))
})

authRoutes.post('/change-password', requireAuth, authLimiter, async (req, res) => {
  const { password } = parseBody(changePasswordSchema, req.body)
  res.json(await auth.changePassword(userIdOf(req), password))
})

authRoutes.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await auth.findById(userIdOf(req)) })
})
