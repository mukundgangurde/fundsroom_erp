import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import './App.css'

type Role = 'ADMIN' | 'SALES'
type View = 'enquiries' | 'quotations' | 'orders'
type Session = { token: string; user: { id: number; name: string; email: string; role: Role } }
type Product = { id: number; code: string; name: string; category: string; unit: string; basePrice: number | string; physicalQty: number; reservedQty: number; availableQty: number }
type EnquiryItem = { productId: number; productName: string; quantity: number; notes?: string }
type Enquiry = { id: number; enquiryNumber: string; enquiryDate: string; requiredDate: string; status: string; companyName: string; contactPerson: string; mobile: string; email: string; city: string; items: EnquiryItem[] }
type QuoteItem = { productId: number; productName: string; quantity: number; unitPrice: number | string; discountPct: number | string; gstPct: number | string; lineAmount: number | string }
type Quotation = { id: number; quotationNumber: string; status: string; validUntil: string; grandTotal: number | string; enquiryNumber: string; companyName: string; items: QuoteItem[] }
type OrderItem = { productId: number; productName: string; quantity: number; unit: string }
type SalesOrder = { id: number; orderNumber: string; orderDate: string; status: string; totalAmount: number | string; companyName: string; quotationNumber: string; dispatchNumber?: string; items: OrderItem[] }
type EnquiryLineDraft = { productId: string; quantity: string }

const today = new Date().toISOString().slice(0, 10)
const money = (value: number | string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value))

async function request<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
  return payload as T
}

async function getWorkspace(token: string) {
  const [products, enquiries, quotations, orders] = await Promise.all([
    request<Product[]>('/products', token),
    request<Enquiry[]>('/enquiries', token),
    request<Quotation[]>('/quotations', token),
    request<SalesOrder[]>('/sales-orders', token),
  ])
  return { products, enquiries, quotations, orders }
}

function readSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem('fundsroom-session') || 'null') as Session | null
  } catch {
    return null
  }
}

function App() {
  const [session, setSession] = useState<Session | null>(readSession)
  const [view, setView] = useState<View>('enquiries')
  const [products, setProducts] = useState<Product[]>([])
  const [enquiries, setEnquiries] = useState<Enquiry[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [showEnquiryForm, setShowEnquiryForm] = useState(false)
  const [showQuoteForm, setShowQuoteForm] = useState(false)
  const [quoteEnquiryId, setQuoteEnquiryId] = useState('')
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([])
  const [dispatchOrder, setDispatchOrder] = useState<SalesOrder | null>(null)
  const [stockProduct, setStockProduct] = useState<Product | null>(null)
  const [enquiryLines, setEnquiryLines] = useState<EnquiryLineDraft[]>([{ productId: '', quantity: '1' }])

  useEffect(() => {
    if (!session) return
    getWorkspace(session.token)
      .then((data) => {
        setProducts(data.products)
        setEnquiries(data.enquiries)
        setQuotations(data.quotations)
        setOrders(data.orders)
      })
      .catch((loadError: Error) => setError(loadError.message))
  }, [session])

  async function refresh() {
    if (!session) return
    const data = await getWorkspace(session.token)
    setProducts(data.products)
    setEnquiries(data.enquiries)
    setQuotations(data.quotations)
    setOrders(data.orders)
  }

  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh()
      setNotice(message)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const nextSession = await request<Session>('/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      })
      localStorage.setItem('fundsroom-session', JSON.stringify(nextSession))
      setSession(nextSession)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.')
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    localStorage.removeItem('fundsroom-session')
    setSession(null)
    setProducts([])
    setEnquiries([])
    setQuotations([])
    setOrders([])
  }

  async function createEnquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const items = enquiryLines.filter((line) => line.productId).map((line) => ({ productId: Number(line.productId), quantity: Number(line.quantity) }))
    await perform(async () => {
      await request('/enquiries', session?.token, {
        method: 'POST',
        body: JSON.stringify({
          companyName: form.get('companyName'), contactPerson: form.get('contactPerson'), mobile: form.get('mobile'),
          email: form.get('email'), city: form.get('city'), requiredDate: form.get('requiredDate'), items,
        }),
      })
      setShowEnquiryForm(false)
      setEnquiryLines([{ productId: '', quantity: '1' }])
    }, 'Enquiry created.')
  }

  function openQuote(enquiry: Enquiry) {
    setQuoteEnquiryId(String(enquiry.id))
    setQuoteItems(enquiry.items.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId)
      return { productId: item.productId, productName: item.productName, quantity: item.quantity, unitPrice: Number(product?.basePrice || 0), discountPct: 0, gstPct: 18, lineAmount: 0 }
    }))
    setShowQuoteForm(true)
  }

  function changeQuoteItem(index: number, field: 'quantity' | 'unitPrice' | 'discountPct' | 'gstPct', value: string) {
    setQuoteItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }

  async function createQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const items = quoteItems.map(({ productId, quantity, unitPrice, discountPct, gstPct }) => ({ productId, quantity: Number(quantity), unitPrice: Number(unitPrice), discountPct: Number(discountPct), gstPct: Number(gstPct) }))
    await perform(async () => {
      await request('/quotations', session?.token, { method: 'POST', body: JSON.stringify({ enquiryId: Number(quoteEnquiryId), validUntil: form.get('validUntil'), items }) })
      setShowQuoteForm(false)
    }, 'Quotation saved as draft.')
  }

  async function updateQuote(quotation: Quotation, status: string) {
    await perform(() => request(`/quotations/${quotation.id}/status`, session?.token, { method: 'PATCH', body: JSON.stringify({ status }) }), `Quotation marked ${status.toLowerCase()}.`)
  }

  async function convertQuote(quotation: Quotation) {
    await perform(() => request(`/quotations/${quotation.id}/convert`, session?.token, { method: 'POST', body: '{}' }), 'Sales order created.')
  }

  async function confirmOrder(order: SalesOrder) {
    await perform(() => request(`/sales-orders/${order.id}/confirm`, session?.token, { method: 'POST', body: '{}' }), 'Stock reserved and order confirmed.')
  }

  async function dispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dispatchOrder) return
    const form = new FormData(event.currentTarget)
    const order = dispatchOrder
    await perform(async () => {
      await request(`/sales-orders/${order.id}/dispatch`, session?.token, {
        method: 'POST', body: JSON.stringify({ vehicleNumber: form.get('vehicleNumber'), driverName: form.get('driverName') }),
      })
      setDispatchOrder(null)
    }, 'Dispatch recorded and inventory updated.')
  }

  async function updateStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!stockProduct) return
    const physicalQty = Number(new FormData(event.currentTarget).get('physicalQty'))
    const product = stockProduct
    await perform(async () => {
      await request(`/inventory/${product.id}`, session?.token, { method: 'PATCH', body: JSON.stringify({ physicalQty }) })
      setStockProduct(null)
    }, 'Physical inventory updated.')
  }

  if (!session) {
    return (
      <main className="login-layout">
        <section className="login-panel">
          <div className="brand-lockup"><span className="brand-mark">F</span><span>FUNDSROOM <small>OPERATIONS</small></span></div>
          <p className="eyebrow">INDUSTRIAL SALES WORKSPACE</p>
          <h1>Every order,<br /><em>accounted for.</em></h1>
          <p className="login-copy">A connected view from first customer enquiry through dispatch.</p>
          <form className="login-form" onSubmit={signIn}>
            <label>Email address<input name="email" type="email" autoComplete="username" placeholder="name@company.com" required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
            {error && <p className="inline-error">{error}</p>}
            <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span></button>
          </form>
          <div className="demo-credentials"><span>DEMO ACCESS</span><p>Admin: `admin@fundsroom.local` / `Admin@123`</p><p>Sales: `sales@fundsroom.local` / `Sales@123`</p></div>
        </section>
        <aside className="login-aside">
          <div className="aside-topline"><span>01 / 03</span><span>SALES OPERATIONS</span></div>
          <div className="flow-map"><span className="flow-line" />{['ENQUIRY', 'QUOTATION', 'SALES ORDER', 'DISPATCH'].map((stage, index) => <div className={`flow-stage ${index === 0 ? 'is-current' : ''}`} key={stage}><span>{`0${index + 1}`}</span><strong>{stage}</strong></div>)}</div>
          <p className="aside-caption">From customer requirement<br />to goods leaving the floor.</p>
        </aside>
      </main>
    )
  }

  const isAdmin = session.user.role === 'ADMIN'
  const pageTitle = view === 'enquiries' ? 'Customer enquiries' : view === 'quotations' ? 'Quotations' : 'Sales orders'
  const activeEnquiries = enquiries.filter((enquiry) => !['WON', 'LOST'].includes(enquiry.status)).length
  const pendingOrders = orders.filter((order) => order.status === 'PENDING').length
  const availableUnits = products.reduce((sum, product) => sum + Number(product.availableQty), 0)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#workspace" aria-label="Fundsroom home"><span className="brand-mark">F</span><span>FUNDSROOM <small>ERP WORKSPACE</small></span></a>
        <p className="nav-label">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={view === 'enquiries' ? 'nav-item active' : 'nav-item'} onClick={() => setView('enquiries')}><span className="nav-glyph">01</span>Enquiries<span className="nav-count">{enquiries.length}</span></button>
          <button className={view === 'quotations' ? 'nav-item active' : 'nav-item'} onClick={() => setView('quotations')}><span className="nav-glyph">02</span>Quotations<span className="nav-count">{quotations.length}</span></button>
          <button className={view === 'orders' ? 'nav-item active' : 'nav-item'} onClick={() => setView('orders')}><span className="nav-glyph">03</span>Sales orders<span className="nav-count">{orders.length}</span></button>
        </nav>
        <div className="sidebar-bottom"><span className="connection-dot" /> PostgreSQL connected <small>API · localhost:3001</small></div>
      </aside>

      <main className="workspace" id="workspace">
        <header className="topbar"><div className="breadcrumb">Fundsroom <span>/</span> Operations <span>/</span> <strong>{pageTitle}</strong></div><div className="user-menu"><div className="user-avatar">{session.user.name.slice(0, 1)}</div><div><strong>{session.user.name}</strong><small>{isAdmin ? 'Administrator' : 'Sales user'}</small></div><button className="text-button" onClick={signOut}>Sign out</button></div></header>
        <div className="page-content">
          <div className="page-heading"><div><p className="eyebrow">COMMERCIAL OPERATIONS / {view === 'orders' ? 'FULFILMENT' : 'PIPELINE'}</p><h1>{pageTitle}</h1><p className="page-subtitle">{view === 'enquiries' ? 'Capture customer requirements and start a traceable sales workflow.' : view === 'quotations' ? 'Prepare, review and convert customer pricing.' : 'Confirm demand against stock, then record dispatch.'}</p></div>{view === 'enquiries' && <button className="button button-primary" onClick={() => setShowEnquiryForm(true)}><span aria-hidden="true">＋</span> New enquiry</button>}</div>

          <section className="metric-row" aria-label="Workspace summary">
            <article className="metric"><span>OPEN ENQUIRIES</span><strong>{activeEnquiries.toString().padStart(2, '0')}</strong><small>Awaiting an outcome</small></article>
            <article className="metric"><span>LIVE QUOTATIONS</span><strong>{quotations.filter((quote) => ['DRAFT', 'SENT'].includes(quote.status)).length.toString().padStart(2, '0')}</strong><small>In customer review</small></article>
            <article className="metric"><span>ORDERS TO CONFIRM</span><strong>{pendingOrders.toString().padStart(2, '0')}</strong><small>{isAdmin ? 'Admin action required' : 'Awaiting admin confirmation'}</small></article>
            <article className="metric metric-stock"><span>AVAILABLE UNITS</span><strong>{availableUnits.toLocaleString('en-IN')}</strong><small>Across {products.length} product lines</small></article>
          </section>

          {error && <div className="alert alert-error" role="alert">{error}<button aria-label="Dismiss" onClick={() => setError('')}>×</button></div>}
          {notice && <div className="alert alert-success" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}

          {view === 'enquiries' && <section className="data-section"><div className="section-heading"><div><h2>Enquiry register</h2><p>Customer needs, requested dates and product quantities</p></div><span className="record-count">{enquiries.length} RECORDS</span></div>
            {enquiries.length === 0 ? <EmptyState title="No enquiries yet" detail="Create the first customer enquiry to start the workflow." action={<button className="button button-secondary" onClick={() => setShowEnquiryForm(true)}>Create enquiry</button>} /> : <div className="table-scroll"><table><thead><tr><th>ENQUIRY</th><th>CUSTOMER</th><th>PRODUCTS</th><th>REQUIRED BY</th><th>STATUS</th><th /></tr></thead><tbody>{enquiries.map((enquiry) => <tr key={enquiry.id}><td><strong className="record-id">{enquiry.enquiryNumber}</strong><small>Created {enquiry.enquiryDate?.slice(0, 10)}</small></td><td><strong>{enquiry.companyName}</strong><small>{enquiry.contactPerson} · {enquiry.city}</small></td><td><div className="product-stack">{enquiry.items.map((item) => <span key={item.productId}>{item.productName} <b>× {item.quantity}</b></span>)}</div></td><td>{enquiry.requiredDate?.slice(0, 10)}</td><td><StatusBadge value={enquiry.status} /></td><td>{!['WON', 'LOST'].includes(enquiry.status) && <button className="button button-small button-secondary" onClick={() => openQuote(enquiry)}>Create quote</button>}</td></tr>)}</tbody></table></div>}
          </section>}

          {view === 'quotations' && <section className="data-section"><div className="section-heading"><div><h2>Quotation register</h2><p>Server-priced offers linked to customer enquiries</p></div><span className="record-count">{quotations.length} RECORDS</span></div>
            {quotations.length === 0 ? <EmptyState title="No quotations yet" detail="Create a quotation from an open enquiry." action={<button className="button button-secondary" onClick={() => setView('enquiries')}>View enquiries</button>} /> : <div className="table-scroll"><table><thead><tr><th>QUOTATION</th><th>CUSTOMER / ENQUIRY</th><th>LINES</th><th>VALID UNTIL</th><th>TOTAL</th><th>STATUS</th><th /></tr></thead><tbody>{quotations.map((quotation) => <tr key={quotation.id}><td><strong className="record-id">{quotation.quotationNumber}</strong></td><td><strong>{quotation.companyName}</strong><small>{quotation.enquiryNumber}</small></td><td><div className="product-stack">{quotation.items.map((item) => <span key={item.productId}>{item.productName} <b>× {item.quantity}</b></span>)}</div></td><td>{quotation.validUntil?.slice(0, 10)}</td><td className="money-cell">{money(quotation.grandTotal)}</td><td><StatusBadge value={quotation.status} /></td><td><div className="row-actions">{quotation.status === 'DRAFT' && <button className="button button-small button-secondary" disabled={busy} onClick={() => void updateQuote(quotation, 'SENT')}>Send</button>}{quotation.status === 'SENT' && <><button className="button button-small button-secondary" disabled={busy} onClick={() => void updateQuote(quotation, 'ACCEPTED')}>Accept</button><button className="button button-small button-quiet" disabled={busy} onClick={() => void updateQuote(quotation, 'REJECTED')}>Reject</button></>}{quotation.status === 'ACCEPTED' && !orders.some((order) => order.quotationNumber === quotation.quotationNumber) && <button className="button button-small button-primary" disabled={busy} onClick={() => void convertQuote(quotation)}>Create order</button>}</div></td></tr>)}</tbody></table></div>}
          </section>}

          {view === 'orders' && <>
            <section className="data-section"><div className="section-heading"><div><h2>Sales order register</h2><p>Confirm stock reservations and record outbound dispatches</p></div><span className="record-count">{orders.length} RECORDS</span></div>
              {orders.length === 0 ? <EmptyState title="No sales orders yet" detail="Orders appear here after an accepted quotation is converted." action={<button className="button button-secondary" onClick={() => setView('quotations')}>View quotations</button>} /> : <div className="table-scroll"><table><thead><tr><th>ORDER</th><th>CUSTOMER / QUOTE</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><strong className="record-id">{order.orderNumber}</strong><small>{order.orderDate?.slice(0, 10)}</small></td><td><strong>{order.companyName}</strong><small>{order.quotationNumber}</small></td><td><div className="product-stack">{order.items.map((item) => <span key={item.productId}>{item.productName} <b>× {item.quantity} {item.unit}</b></span>)}</div></td><td className="money-cell">{money(order.totalAmount)}</td><td><StatusBadge value={order.status} />{order.dispatchNumber && <small className="dispatch-id">{order.dispatchNumber}</small>}</td><td>{isAdmin && order.status === 'PENDING' && <button className="button button-small button-primary" disabled={busy} onClick={() => void confirmOrder(order)}>Confirm &amp; reserve</button>}{isAdmin && order.status === 'CONFIRMED' && <button className="button button-small button-secondary" onClick={() => setDispatchOrder(order)}>Dispatch</button>}{!isAdmin && order.status === 'PENDING' && <span className="action-hint">Admin confirmation</span>}</td></tr>)}</tbody></table></div>}
            </section>
            <section className="data-section inventory-section"><div className="section-heading"><div><h2>Inventory availability</h2><p>Available = physical − reserved</p></div><span className="record-count">{products.length} PRODUCTS</span></div><div className="table-scroll"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PHYSICAL</th><th>RESERVED</th><th>AVAILABLE</th>{isAdmin && <th />}</tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small>{product.code} · {money(product.basePrice)} / {product.unit}</small></td><td>{product.category}</td><td>{product.physicalQty}</td><td>{product.reservedQty}</td><td><strong className={Number(product.availableQty) === 0 ? 'qty-empty' : 'qty-available'}>{product.availableQty}</strong></td>{isAdmin && <td><button className="button button-small button-quiet" onClick={() => setStockProduct(product)}>Adjust stock</button></td>}</tr>)}</tbody></table></div></section>
          </>}
          <footer className="page-footer"><span>FUNDSROOM INFOTECH · CASE STUDY</span><span>Business records are enforced by PostgreSQL</span></footer>
        </div>
      </main>

      {showEnquiryForm && <Modal title="New customer enquiry" close={() => setShowEnquiryForm(false)}><form className="form-grid" onSubmit={createEnquiry}>
        <label className="field-wide">Company name<input name="companyName" required placeholder="ABC Engineering Pvt. Ltd." /></label>
        <label>Contact person<input name="contactPerson" required placeholder="Full name" /></label><label>Mobile<input name="mobile" required placeholder="+91 98765 43210" /></label>
        <label>Email<input name="email" type="email" required placeholder="contact@company.com" /></label><label>City<input name="city" required placeholder="Pune" /></label>
        <label className="field-wide">Required date<input name="requiredDate" type="date" min={today} required /></label>
        <div className="field-wide form-divider"><span>PRODUCT REQUIREMENTS</span><button type="button" className="text-button" onClick={() => setEnquiryLines((current) => [...current, { productId: '', quantity: '1' }])}>＋ Add product</button></div>
        {enquiryLines.map((line, index) => <div className="item-entry field-wide" key={index}><select aria-label="Product" value={line.productId} required onChange={(event) => setEnquiryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, productId: event.target.value } : item))}><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.code}</option>)}</select><input aria-label="Quantity" type="number" min="1" step="1" value={line.quantity} required onChange={(event) => setEnquiryLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} />{enquiryLines.length > 1 && <button type="button" className="icon-button" aria-label="Remove product" onClick={() => setEnquiryLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>}</div>)}
        <div className="form-actions field-wide"><button type="button" className="button button-quiet" onClick={() => setShowEnquiryForm(false)}>Cancel</button><button className="button button-primary" disabled={busy}>Save enquiry</button></div>
      </form></Modal>}

      {showQuoteForm && <Modal title="Prepare quotation" close={() => setShowQuoteForm(false)}><form className="form-grid" onSubmit={createQuote}>
        <label className="field-wide">Customer enquiry<select value={quoteEnquiryId} required onChange={(event) => { const selected = enquiries.find((item) => item.id === Number(event.target.value)); setQuoteEnquiryId(event.target.value); if (selected) openQuote(selected) }}>{enquiries.filter((item) => !['WON', 'LOST'].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.enquiryNumber} · {item.companyName}</option>)}</select></label>
        <label className="field-wide">Valid until<input name="validUntil" type="date" min={today} required /></label>
        <div className="quote-lines field-wide">{quoteItems.map((item, index) => <div className="quote-line" key={item.productId}><strong>{item.productName}</strong><label>Quantity<input type="number" min="1" max={enquiries.find((enquiry) => enquiry.id === Number(quoteEnquiryId))?.items.find((enquiryItem) => enquiryItem.productId === item.productId)?.quantity} step="1" value={item.quantity} required onChange={(event) => changeQuoteItem(index, 'quantity', event.target.value)} /></label><label>Unit price<input type="number" min="0" step="0.01" value={item.unitPrice} required onChange={(event) => changeQuoteItem(index, 'unitPrice', event.target.value)} /></label><label>Discount %<input type="number" min="0" max="100" step="0.01" value={item.discountPct} onChange={(event) => changeQuoteItem(index, 'discountPct', event.target.value)} /></label><label>GST %<input type="number" min="0" max="100" step="0.01" value={item.gstPct} onChange={(event) => changeQuoteItem(index, 'gstPct', event.target.value)} /></label></div>)}</div>
        <div className="quote-note field-wide">Final amounts are recalculated and stored by the API.</div>
        <div className="form-actions field-wide"><button type="button" className="button button-quiet" onClick={() => setShowQuoteForm(false)}>Cancel</button><button className="button button-primary" disabled={busy}>Save draft quote</button></div>
      </form></Modal>}

      {dispatchOrder && <Modal title={`Dispatch ${dispatchOrder.orderNumber}`} close={() => setDispatchOrder(null)}><form className="form-grid" onSubmit={dispatch}><p className="field-wide modal-intro">This records all reserved order quantities as dispatched and reduces physical stock.</p><label>Vehicle number<input name="vehicleNumber" required placeholder="MH 12 AB 1234" /></label><label>Driver name<input name="driverName" required placeholder="Full name" /></label><div className="form-actions field-wide"><button type="button" className="button button-quiet" onClick={() => setDispatchOrder(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Record dispatch</button></div></form></Modal>}

      {stockProduct && <Modal title={`Adjust ${stockProduct.code}`} close={() => setStockProduct(null)}><form className="form-grid" onSubmit={updateStock}><p className="field-wide modal-intro">Reserved stock is {stockProduct.reservedQty}. Physical quantity cannot be set below it.</p><label className="field-wide">Physical quantity<input name="physicalQty" type="number" min={stockProduct.reservedQty} step="1" defaultValue={stockProduct.physicalQty} required /></label><div className="form-actions field-wide"><button type="button" className="button button-quiet" onClick={() => setStockProduct(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Update stock</button></div></form></Modal>}
    </div>
  )
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`status-badge status-${value.toLowerCase()}`}>{value.replace('_', ' ')}</span>
}

function EmptyState({ title, detail, action }: { title: string; detail: string; action: ReactNode }) {
  return <div className="empty-state"><span className="empty-index">00</span><div><h3>{title}</h3><p>{detail}</p></div>{action}</div>
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><div><p className="eyebrow">WORKFLOW ENTRY</p><h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={close}>×</button></header>{children}</section></div>
}

export default App
