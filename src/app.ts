import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { corsOrigins } from './config/env.js'
import { pool } from './db/pool.js'
import { errorHandler, notFound } from './middlewares/errorHandler.js'
import { agentRoutes } from './modules/agent/agent.routes.js'
import { authRoutes } from './modules/auth/auth.routes.js'
import { backupRoutes } from './modules/backup/backup.routes.js'

/** "https://*.vercel.app" vira regex, para aceitar os domínios de preview da Vercel. */
const allowedOrigins = corsOrigins.map((o) =>
  o.includes('*')
    ? new RegExp(`^${o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')}$`)
    : o,
)

export const app = express()

// Confia em proxies locais (ngrok, vite preview, rede do Docker) para ler o IP real do visitante
app.set('trust proxy', 'loopback, linklocal, uniquelocal')

app.use(helmet())
app.use(
  cors({
    origin: corsOrigins.includes('*') ? true : allowedOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
)
// O histórico de vendas do fecho do dia cresce com o tempo (~150 bytes por registro)
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', time: new Date().toISOString() })
})

app.use('/api/auth', authRoutes)
app.use('/api/backup', backupRoutes)
app.use('/api/agent', agentRoutes)

app.use(notFound)
app.use(errorHandler)
