import 'dotenv/config'
import pg from 'pg'
import { createApp } from './app.js'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const port = Number(process.env.API_PORT || 3001)

pool.query('SELECT 1')
  .then(() => {
    createApp(pool).listen(port, () => console.log(`Fundsroom API listening on http://localhost:${port}`))
  })
  .catch((error) => {
    console.error('Could not connect to PostgreSQL:', error.message)
    process.exitCode = 1
  })