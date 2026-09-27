import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { allowRoles, createToken, requireAuth } from './auth.js'
import {
  assertCanConvertQuotation,
  calculateQuotation,
  DomainError,
  reserveInventory,
} from './domain.js'

const salesRoles = ['ADMIN', 'SALES']
const adminRoles = ['ADMIN']

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new DomainError(`${label} is required.`)
  return value.trim()
}

function positiveId(value, label = 'ID') {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new DomainError(`${label} must be a positive integer.`)
  return id
}

function generatedNumber(prefix) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase()
  return `${prefix}-${suffix}`
}

async function transaction(pool, operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export function createApp(pool) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }))

  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const email = requiredText(req.body.email, 'Email').toLowerCase()
    const password = requiredText(req.body.password, 'Password')
    const { rows } = await pool.query(
      'SELECT id, name, email, password_hash, role FROM users WHERE email = $1',
      [email],
    )
    const user = rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new DomainError('Email or password is incorrect.', 401)
    }
    const publicUser = { id: Number(user.id), name: user.name, email: user.email, role: user.role }
    res.json({ token: createToken(publicUser), user: publicUser })
  }))

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }))

  app.get('/api/products', requireAuth, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT p.id, p.code, p.name, p.category, p.unit, p.base_price AS "basePrice",
             COALESCE(i.physical_qty, 0) AS "physicalQty",
             COALESCE(i.reserved_qty, 0) AS "reservedQty",
             COALESCE(i.available_qty, 0) AS "availableQty"
      FROM products p LEFT JOIN inventory i ON i.product_id = p.id
      ORDER BY p.name
    `)
    res.json(rows)
  }))

  app.patch('/api/inventory/:productId', requireAuth, allowRoles(...adminRoles), asyncRoute(async (req, res) => {
    const productId = positiveId(req.params.productId, 'Product ID')
    const physicalQty = Number(req.body.physicalQty)
    if (!Number.isInteger(physicalQty) || physicalQty < 0) throw new DomainError('Physical quantity must be a non-negative whole number.')
    const result = await pool.query(
      'UPDATE inventory SET physical_qty = $1 WHERE product_id = $2 AND reserved_qty <= $1 RETURNING product_id, physical_qty, reserved_qty, available_qty',
      [physicalQty, productId],
    )
    if (!result.rowCount) throw new DomainError('Product inventory was not found or physical quantity is below reserved quantity.', 409)
    res.json(result.rows[0])
  }))

  app.get('/api/enquiries', requireAuth, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT e.id, e.enquiry_number AS "enquiryNumber", e.enquiry_date AS "enquiryDate",
             e.required_date AS "requiredDate", e.status,
             c.company_name AS "companyName", c.contact_person AS "contactPerson",
             c.mobile, c.email, c.city,
             COALESCE(json_agg(json_build_object('productId', p.id, 'productName', p.name,
                'quantity', ei.quantity, 'notes', ei.notes)) FILTER (WHERE p.id IS NOT NULL), '[]') AS items
      FROM enquiries e JOIN customers c ON c.id = e.customer_id
      LEFT JOIN enquiry_items ei ON ei.enquiry_id = e.id
      LEFT JOIN products p ON p.id = ei.product_id
      GROUP BY e.id, c.id ORDER BY e.created_at DESC
    `)
    res.json(rows)
  }))

  app.post('/api/enquiries', requireAuth, allowRoles(...salesRoles), asyncRoute(async (req, res) => {
    const body = req.body
    const items = body.items
    if (!Array.isArray(items) || items.length === 0) throw new DomainError('Add at least one enquiry product.')
    const customer = {
      companyName: requiredText(body.companyName, 'Company name'),
      contactPerson: requiredText(body.contactPerson, 'Contact person'),
      mobile: requiredText(body.mobile, 'Mobile'),
      email: requiredText(body.email, 'Email'),
      city: requiredText(body.city, 'City'),
    }
    const enquiry = await transaction(pool, async (client) => {
      const customerResult = await client.query(
        'INSERT INTO customers (company_name, contact_person, mobile, email, city) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [customer.companyName, customer.contactPerson, customer.mobile, customer.email, customer.city],
      )
      const enquiryResult = await client.query(
        `INSERT INTO enquiries (enquiry_number, customer_id, created_by, enquiry_date, required_date)
         VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5::date) RETURNING id, enquiry_number AS "enquiryNumber", status`,
        [generatedNumber('ENQ'), customerResult.rows[0].id, req.user.id, body.enquiryDate || null, requiredText(body.requiredDate, 'Required date')],
      )
      for (const item of items) {
        await client.query(
          'INSERT INTO enquiry_items (enquiry_id, product_id, quantity, notes) VALUES ($1, $2, $3, $4)',
          [enquiryResult.rows[0].id, positiveId(item.productId, 'Product ID'), positiveId(item.quantity, 'Quantity'), item.notes || null],
        )
      }
      return { ...enquiryResult.rows[0], ...customer }
    })
    res.status(201).json(enquiry)
  }))

  app.get('/api/quotations', requireAuth, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT q.id, q.quotation_number AS "quotationNumber", q.status, q.valid_until AS "validUntil",
             q.grand_total AS "grandTotal", e.enquiry_number AS "enquiryNumber", c.company_name AS "companyName",
             COALESCE(json_agg(json_build_object('productId', p.id, 'productName', p.name,
                'quantity', qi.quantity, 'unitPrice', qi.unit_price, 'discountPct', qi.discount_pct,
                'gstPct', qi.gst_pct, 'lineAmount', qi.line_amount)) FILTER (WHERE p.id IS NOT NULL), '[]') AS items
      FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id JOIN customers c ON c.id = e.customer_id
      LEFT JOIN quotation_items qi ON qi.quotation_id = q.id LEFT JOIN products p ON p.id = qi.product_id
      GROUP BY q.id, e.id, c.id ORDER BY q.created_at DESC
    `)
    res.json(rows)
  }))

  app.post('/api/quotations', requireAuth, allowRoles(...salesRoles), asyncRoute(async (req, res) => {
    const enquiryId = positiveId(req.body.enquiryId, 'Enquiry ID')
    const validUntil = requiredText(req.body.validUntil, 'Valid until date')
    const quotation = calculateQuotation(req.body.items)
    const result = await transaction(pool, async (client) => {
      const enquiryResult = await client.query('SELECT id, status FROM enquiries WHERE id = $1 FOR UPDATE', [enquiryId])
      if (!enquiryResult.rowCount) throw new DomainError('Enquiry not found.', 404)
      if (['WON', 'LOST'].includes(enquiryResult.rows[0].status)) throw new DomainError('A closed enquiry cannot receive a new quotation.', 409)
      const enquiryItems = await client.query('SELECT product_id, quantity FROM enquiry_items WHERE enquiry_id = $1', [enquiryId])
      const allowedItems = new Map(enquiryItems.rows.map((item) => [Number(item.product_id), Number(item.quantity)]))
      for (const item of quotation.items) {
        if (!allowedItems.has(item.productId) || item.quantity > allowedItems.get(item.productId)) {
          throw new DomainError('Quotation products and quantities must match the enquiry.', 400)
        }
      }
      const quoteResult = await client.query(
        'INSERT INTO quotations (quotation_number, enquiry_id, valid_until, grand_total) VALUES ($1, $2, $3::date, $4) RETURNING id, quotation_number AS "quotationNumber", status, grand_total AS "grandTotal"',
        [generatedNumber('QUO'), enquiryId, validUntil, quotation.grandTotal],
      )
      for (const item of quotation.items) {
        await client.query(
          `INSERT INTO quotation_items (quotation_id, product_id, quantity, unit_price, discount_pct, gst_pct, line_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [quoteResult.rows[0].id, item.productId, item.quantity, item.unitPrice, item.discountPct, item.gstPct, item.lineAmount],
        )
      }
      await client.query("UPDATE enquiries SET status = 'QUOTED' WHERE id = $1 AND status = 'NEW'", [enquiryId])
      return quoteResult.rows[0]
    })
    res.status(201).json(result)
  }))

  app.patch('/api/quotations/:id/status', requireAuth, allowRoles(...salesRoles), asyncRoute(async (req, res) => {
    const quotationId = positiveId(req.params.id, 'Quotation ID')
    const nextStatus = req.body.status
    const result = await transaction(pool, async (client) => {
      const current = await client.query('SELECT id, enquiry_id, status FROM quotations WHERE id = $1 FOR UPDATE', [quotationId])
      if (!current.rowCount) throw new DomainError('Quotation not found.', 404)
      const allowed = current.rows[0].status === 'DRAFT' ? ['SENT'] : current.rows[0].status === 'SENT' ? ['ACCEPTED', 'REJECTED'] : []
      if (!allowed.includes(nextStatus)) throw new DomainError(`Cannot change quotation from ${current.rows[0].status} to ${nextStatus}.`, 409)
      const updated = await client.query('UPDATE quotations SET status = $1 WHERE id = $2 RETURNING id, status', [nextStatus, quotationId])
      if (nextStatus === 'ACCEPTED') await client.query("UPDATE enquiries SET status = 'WON' WHERE id = $1", [current.rows[0].enquiry_id])
      if (nextStatus === 'REJECTED') await client.query("UPDATE enquiries SET status = 'LOST' WHERE id = $1", [current.rows[0].enquiry_id])
      return updated.rows[0]
    })
    res.json(result)
  }))

  app.post('/api/quotations/:id/convert', requireAuth, allowRoles(...salesRoles), asyncRoute(async (req, res) => {
    const quotationId = positiveId(req.params.id, 'Quotation ID')
    const order = await transaction(pool, async (client) => {
      const quoteResult = await client.query(`
        SELECT q.id, q.status, q.grand_total, e.customer_id,
               (SELECT id FROM sales_orders WHERE quotation_id = q.id) AS order_id
        FROM quotations q JOIN enquiries e ON e.id = q.enquiry_id WHERE q.id = $1 FOR UPDATE OF q
      `, [quotationId])
      if (!quoteResult.rowCount) throw new DomainError('Quotation not found.', 404)
      const quote = quoteResult.rows[0]
      assertCanConvertQuotation(quote.status, quote.order_id)
      const inserted = await client.query(
        'INSERT INTO sales_orders (order_number, quotation_id, customer_id, total_amount) VALUES ($1, $2, $3, $4) RETURNING id, order_number AS "orderNumber", status, total_amount AS "totalAmount"',
        [generatedNumber('SO'), quotationId, quote.customer_id, quote.grand_total],
      )
      await client.query(
        `INSERT INTO sales_order_items (sales_order_id, product_id, quantity, unit_price)
         SELECT $1, product_id, quantity, unit_price FROM quotation_items WHERE quotation_id = $2`,
        [inserted.rows[0].id, quotationId],
      )
      return inserted.rows[0]
    })
    res.status(201).json(order)
  }))

  app.get('/api/sales-orders', requireAuth, asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT so.id, so.order_number AS "orderNumber", so.order_date AS "orderDate", so.status,
             so.total_amount AS "totalAmount", c.company_name AS "companyName",
             q.quotation_number AS "quotationNumber", d.dispatch_number AS "dispatchNumber",
             COALESCE(json_agg(json_build_object('productId', p.id, 'productName', p.name,
                'quantity', soi.quantity, 'unit', p.unit)) FILTER (WHERE p.id IS NOT NULL), '[]') AS items
      FROM sales_orders so JOIN customers c ON c.id = so.customer_id
      JOIN quotations q ON q.id = so.quotation_id LEFT JOIN dispatches d ON d.sales_order_id = so.id
      LEFT JOIN sales_order_items soi ON soi.sales_order_id = so.id LEFT JOIN products p ON p.id = soi.product_id
      GROUP BY so.id, c.id, q.id, d.id ORDER BY so.created_at DESC
    `)
    res.json(rows)
  }))

  app.post('/api/sales-orders/:id/confirm', requireAuth, allowRoles(...adminRoles), asyncRoute(async (req, res) => {
    const orderId = positiveId(req.params.id, 'Sales order ID')
    const result = await transaction(pool, async (client) => {
      const order = await client.query('SELECT id, status FROM sales_orders WHERE id = $1 FOR UPDATE', [orderId])
      if (!order.rowCount) throw new DomainError('Sales order not found.', 404)
      if (order.rows[0].status !== 'PENDING') throw new DomainError('Only pending orders can be confirmed.', 409)
      const items = await client.query('SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id', [orderId])
      const productIds = items.rows.map((item) => item.product_id)
      const stocks = await client.query('SELECT product_id, physical_qty, reserved_qty FROM inventory WHERE product_id = ANY($1::bigint[]) ORDER BY product_id FOR UPDATE', [productIds])
      const stockByProduct = new Map(stocks.rows.map((stock) => [String(stock.product_id), stock]))
      for (const item of items.rows) {
        const stock = stockByProduct.get(String(item.product_id))
        if (!stock) throw new DomainError('Inventory record not found for a product.', 409)
        const updated = reserveInventory(Number(stock.physical_qty), Number(stock.reserved_qty), Number(item.quantity))
        await client.query('UPDATE inventory SET reserved_qty = $1 WHERE product_id = $2', [updated.reservedQty, item.product_id])
      }
      return client.query("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = $1 RETURNING id, order_number AS \"orderNumber\", status", [orderId])
    })
    res.json(result.rows[0])
  }))

  app.post('/api/sales-orders/:id/dispatch', requireAuth, allowRoles(...adminRoles), asyncRoute(async (req, res) => {
    const orderId = positiveId(req.params.id, 'Sales order ID')
    const vehicleNumber = requiredText(req.body.vehicleNumber, 'Vehicle number')
    const driverName = requiredText(req.body.driverName, 'Driver name')
    const dispatch = await transaction(pool, async (client) => {
      const order = await client.query('SELECT id, status FROM sales_orders WHERE id = $1 FOR UPDATE', [orderId])
      if (!order.rowCount) throw new DomainError('Sales order not found.', 404)
      if (order.rows[0].status !== 'CONFIRMED') throw new DomainError('Only confirmed orders can be dispatched.', 409)
      const items = await client.query('SELECT product_id, quantity FROM sales_order_items WHERE sales_order_id = $1 ORDER BY product_id', [orderId])
      const productIds = items.rows.map((item) => item.product_id)
      const stocks = await client.query('SELECT product_id, physical_qty, reserved_qty FROM inventory WHERE product_id = ANY($1::bigint[]) ORDER BY product_id FOR UPDATE', [productIds])
      const stockByProduct = new Map(stocks.rows.map((stock) => [String(stock.product_id), stock]))
      for (const item of items.rows) {
        const stock = stockByProduct.get(String(item.product_id))
        if (!stock || Number(stock.reserved_qty) < Number(item.quantity) || Number(stock.physical_qty) < Number(item.quantity)) {
          throw new DomainError('Reserved stock is not available for this dispatch.', 409)
        }
      }
      const inserted = await client.query(
        'INSERT INTO dispatches (dispatch_number, sales_order_id, vehicle_number, driver_name) VALUES ($1, $2, $3, $4) RETURNING id, dispatch_number AS "dispatchNumber", sales_order_id AS "salesOrderId", dispatch_date AS "dispatchDate"',
        [generatedNumber('DSP'), orderId, vehicleNumber, driverName],
      )
      for (const item of items.rows) {
        await client.query('UPDATE inventory SET physical_qty = physical_qty - $1, reserved_qty = reserved_qty - $1 WHERE product_id = $2', [item.quantity, item.product_id])
        await client.query('INSERT INTO dispatch_items (dispatch_id, product_id, quantity) VALUES ($1, $2, $3)', [inserted.rows[0].id, item.product_id, item.quantity])
      }
      await client.query("UPDATE sales_orders SET status = 'DISPATCHED' WHERE id = $1", [orderId])
      return inserted.rows[0]
    })
    res.status(201).json(dispatch)
  }))

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    const status = error.status || (error.code === '23505' ? 409 : error.code === '23503' ? 400 : 500)
    if (status >= 500) console.error(error)
    res.status(status).json({ error: status === 500 ? 'Internal server error.' : error.message })
  })

  return app
}