export class DomainError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'DomainError'
    this.status = status
  }
}

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100

export function calculateQuotation(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DomainError('A quotation must contain at least one item.')
  }

  const lines = items.map((item) => {
    const { productId, quantity, unitPrice, discountPct = 0, gstPct = 0 } = item
    if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0) {
      throw new DomainError('Quantity must be a positive whole number.')
    }
    if (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0) {
      throw new DomainError('Unit price must be a non-negative number.')
    }
    if (![discountPct, gstPct].every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100)) {
      throw new DomainError('Discount and GST must be between 0 and 100.')
    }

    const baseAmount = roundMoney(Number(quantity) * Number(unitPrice))
    const discountAmount = roundMoney(baseAmount * Number(discountPct) / 100)
    const taxableAmount = roundMoney(baseAmount - discountAmount)
    const taxAmount = roundMoney(taxableAmount * Number(gstPct) / 100)
    return {
      productId: Number(productId),
      quantity: Number(quantity),
      unitPrice: roundMoney(Number(unitPrice)),
      discountPct: Number(discountPct),
      gstPct: Number(gstPct),
      lineAmount: roundMoney(taxableAmount + taxAmount),
    }
  })

  return {
    items: lines,
    grandTotal: roundMoney(lines.reduce((total, line) => total + line.lineAmount, 0)),
  }
}

export function assertCanConvertQuotation(status, existingOrderId = null) {
  if (status !== 'ACCEPTED') {
    throw new DomainError('Only an accepted quotation can become a sales order.', 409)
  }
  if (existingOrderId !== null && existingOrderId !== undefined) {
    throw new DomainError('This quotation already has a sales order.', 409)
  }
}

export function reserveInventory(physicalQty, reservedQty, requestedQty) {
  if (![physicalQty, reservedQty, requestedQty].every(Number.isInteger) || physicalQty < 0 || reservedQty < 0 || requestedQty <= 0) {
    throw new DomainError('Inventory quantities must be non-negative whole numbers and requested quantity must be positive.')
  }
  const availableQty = physicalQty - reservedQty
  if (requestedQty > availableQty) {
    throw new DomainError('Insufficient available inventory.', 409)
  }
  return { physicalQty, reservedQty: reservedQty + requestedQty, availableQty: availableQty - requestedQty }
}

export function assertRoleAllowed(userRole, allowedRoles) {
  if (!allowedRoles.includes(userRole)) {
    throw new DomainError('You do not have permission to perform this action.', 403)
  }
}