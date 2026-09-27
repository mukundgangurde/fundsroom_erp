import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertCanConvertQuotation,
  assertRoleAllowed,
  calculateQuotation,
  DomainError,
  reserveInventory,
} from './domain.js'

test('quotation totals apply discount before GST and round to paise', () => {
  const quotation = calculateQuotation([
    { productId: 1, quantity: 2, unitPrice: 100, discountPct: 10, gstPct: 18 },
    { productId: 2, quantity: 1, unitPrice: 50, discountPct: 0, gstPct: 5 },
  ])
  assert.equal(quotation.items[0].lineAmount, 212.4)
  assert.equal(quotation.items[1].lineAmount, 52.5)
  assert.equal(quotation.grandTotal, 264.9)
})

test('draft and rejected quotations cannot be converted', () => {
  assert.throws(() => assertCanConvertQuotation('DRAFT'), DomainError)
  assert.throws(() => assertCanConvertQuotation('REJECTED'), DomainError)
})

test('an accepted quotation cannot produce a duplicate order', () => {
  assert.throws(() => assertCanConvertQuotation('ACCEPTED', 42), /already has a sales order/)
  assert.doesNotThrow(() => assertCanConvertQuotation('ACCEPTED'))
})

test('reservation rejects quantities above available stock', () => {
  assert.throws(() => reserveInventory(100, 30, 80), /Insufficient available inventory/)
  assert.deepEqual(reserveInventory(100, 30, 60), {
    physicalQty: 100,
    reservedQty: 90,
    availableQty: 10,
  })
})

test('sales users are denied admin-only actions', () => {
  assert.throws(() => assertRoleAllowed('SALES', ['ADMIN']), (error) => error.status === 403)
  assert.doesNotThrow(() => assertRoleAllowed('ADMIN', ['ADMIN']))
})