# Fundsroom API Reference

Base URL in development: `http://localhost:3001/api` (the Vite server proxies `/api`). Except for login, requests require `Authorization: Bearer <token>` and JSON request bodies use `Content-Type: application/json`.

## Authentication

### `POST /auth/login`

Request:

```json
{
  "email": "sales@fundsroom.local",
  "password": "Sales@123"
}
```

Response: `{ "token": "<jwt>", "user": { "id": 2, "name": "Fundsroom Sales", "email": "sales@fundsroom.local", "role": "SALES" } }`.

## Enquiries

### `GET /enquiries`

Any authenticated role. Returns enquiries with customer fields and an `items` array.

### `POST /enquiries`

Sales or Admin. `enquiryDate` is optional and defaults to the current date.

```json
{
  "companyName": "ABC Engineering Pvt. Ltd.",
  "contactPerson": "Asha Shah",
  "mobile": "+91 98765 43210",
  "email": "asha@example.com",
  "city": "Pune",
  "requiredDate": "2026-10-15",
  "items": [
    { "productId": 1, "quantity": 100 },
    { "productId": 2, "quantity": 40 }
  ]
}
```

## Products and inventory

### `GET /products`

Any authenticated role. Each product includes `physicalQty`, `reservedQty`, and generated `availableQty`.

### `PATCH /inventory/:productId`

Admin only. Changes the physical quantity; the request is rejected if it is negative or below currently reserved quantity.

```json
{ "physicalQty": 200 }
```

## Quotations

### `GET /quotations`

Any authenticated role. Returns quotation lines and the backend-calculated grand total.

### `POST /quotations`

Sales or Admin. Product IDs and quantities must be within the referenced enquiry. Do not send a grand total; the API calculates it.

```json
{
  "enquiryId": 1,
  "validUntil": "2026-10-30",
  "items": [
    { "productId": 1, "quantity": 80, "unitPrice": 28500, "discountPct": 5, "gstPct": 18 },
    { "productId": 2, "quantity": 40, "unitPrice": 42000, "discountPct": 0, "gstPct": 18 }
  ]
}
```

Per item, the API calculates `lineAmount = (quantity × unitPrice × (1 − discountPct / 100)) × (1 + gstPct / 100)`, rounded to two decimal places. `grandTotal` is the sum of rounded line amounts.

### `PATCH /quotations/:id/status`

Sales or Admin. Valid transitions are `DRAFT → SENT`, then `SENT → ACCEPTED` or `SENT → REJECTED`.

```json
{ "status": "SENT" }
```

### `POST /quotations/:id/convert`

Sales or Admin. Empty JSON body. Only an accepted quotation can be converted. A unique constraint prevents a second order from being created for the same quotation.

## Sales orders and dispatch

### `GET /sales-orders`

Any authenticated role. Returns order items, quotation/customer references, status, and dispatch number when dispatched.

### `POST /sales-orders/:id/confirm`

Admin only. Empty JSON body. Reserves all order lines atomically. Insufficient stock returns `409`; physical quantity is not changed.

### `POST /sales-orders/:id/dispatch`

Admin only. Only a confirmed order can be dispatched. Dispatches all reserved quantities in a single transaction.

```json
{
  "vehicleNumber": "MH 12 AB 1234",
  "driverName": "Ravi Patil"
}
```

## Error responses

Errors return `{ "error": "Description" }`. Common status codes are `400` for invalid input/relationships, `401` for missing or invalid authentication, `403` for a role restriction, `404` for a missing record, and `409` for invalid workflow state, insufficient stock, or a uniqueness conflict.