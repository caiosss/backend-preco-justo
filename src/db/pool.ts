import pg from 'pg'
import { env } from '../config/env.js'

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
})

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do Postgres', err)
})
