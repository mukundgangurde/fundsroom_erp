import 'dotenv/config'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const users = [
  { name: 'Fundsroom Administrator', email: 'admin@fundsroom.local', password: 'Admin@123', role: 'ADMIN' },
  { name: 'Fundsroom Sales', email: 'sales@fundsroom.local', password: 'Sales@123', role: 'SALES' },
]

const products = [
  ['MTR-001', 'Three-phase induction motor', 'Electrical', 'pcs', 28500, 120],
  ['PMP-002', 'Centrifugal process pump', 'Pumps', 'pcs', 42000, 80],
  ['BRG-003', 'Heavy-duty ball bearing', 'Mechanical', 'pcs', 1850, 500],
  ['VAL-004', 'Stainless steel gate valve', 'Valves', 'pcs', 7600, 160],
  ['PLC-005', 'Industrial PLC controller', 'Automation', 'pcs', 32500, 45],
  ['CBL-006', 'Armoured copper cable 10m', 'Electrical', 'coil', 5400, 200],
]

try {
  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 12)
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
      [user.name, user.email, passwordHash, user.role],
    )
  }

  for (const [code, name, category, unit, basePrice, physicalQty] of products) {
    const result = await pool.query(
      `INSERT INTO products (code, name, category, unit, base_price) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
         unit = EXCLUDED.unit, base_price = EXCLUDED.base_price RETURNING id`,
      [code, name, category, unit, basePrice],
    )
    await pool.query(
      'INSERT INTO inventory (product_id, physical_qty) VALUES ($1, $2) ON CONFLICT (product_id) DO NOTHING',
      [result.rows[0].id, physicalQty],
    )
  }

  console.log('Seeded 2 demo users and 6 products.')
} finally {
  await pool.end()
}