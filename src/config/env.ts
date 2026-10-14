import { z } from 'zod'

/** Variável vazia no .env conta como não definida. */
const opcional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional())

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter pelo menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('30d'),
    CORS_ORIGIN: z.string().default('*'),
    // Assistente de IA (repo agente-preco-justo). Sem AGENT_URL, /api/agent/chat responde 503.
    AGENT_URL: opcional(z.url('AGENT_URL precisa ser uma URL (ex.: http://localhost:8000)')),
    AGENT_KEY: opcional(z.string().min(32, 'AGENT_KEY precisa ter pelo menos 32 caracteres')),
    AGENT_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  })
  .refine((e) => !e.AGENT_URL || e.AGENT_KEY, {
    message: 'AGENT_KEY é obrigatória quando AGENT_URL está definida',
    path: ['AGENT_KEY'],
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parsed.data

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean)
