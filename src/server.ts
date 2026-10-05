import { app } from './app.js'
import { env } from './config/env.js'
import { migrate } from './db/migrate.js'
import { pool } from './db/pool.js'

async function main() {
  await migrate()
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 API Preço Justo rodando em http://localhost:${env.PORT}`)
  })

  const shutdown = () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0))
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('Falha ao iniciar a API', err)
  process.exit(1)
})
