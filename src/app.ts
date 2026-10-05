import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { corsOrigins } from './config/env.js'
import { pool } from './db/pool.js'
import { errorHandler, notFound } from './middlewares/errorHandler.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { backupRoutes } from './modules/backup/backup.routes.js'

/** "https://*.vercel.app" vira regex, para aceitar os domínios de preview da Vercel. */
const allowedOrigins = corsOrigins.map((o) =>
  o.includes('*')
    ? new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`)
    : o,
)

export const app = express()

// Necessário atrás do ngrok/proxy para o rate limit identificar o IP real
app.set('trust proxy', 1)

app.use(helmet())
app.use(
  cors({
    origin: corsOrigins.includes('*') ? true : allowedOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
)
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', time: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/backup', backupRoutes)

app.use(notFound)
app.use(errorHandler)
