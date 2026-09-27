import assert from 'node:assert/strict'
import test from 'node:test'
import supertest from 'supertest'
import { createApp } from './app.js'
import { createToken } from './auth.js'

test('sales user receives 403 when confirming an order', async () => {
  const app = createApp({})
  const token = createToken({ id: 7, role: 'SALES', email: 'sales@fundsroom.local' })
  const response = await supertest(app)
    .post('/api/sales-orders/12/confirm')
    .set('Authorization', `Bearer ${token}`)
    .send({})

  assert.equal(response.status, 403)
  assert.equal(response.body.error, 'You do not have permission to perform this action.')
})