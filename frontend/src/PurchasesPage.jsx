import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

function todayInBogota() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
  }).format(new Date())
}

export default function PurchasesPage({ onPurchaseSaved, onUnauthorized, token, user }) {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [purchases, setPurchases] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [issuedAt, setIssuedAt] = useState(todayInBogota)
  const [items, setItems] = useState([{ productId: '', quantity: '1', unitCost: '' }])
  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [supplierTaxId, setSupplierTaxId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadData() {
    setIsLoading(true)
    setError('')
    try {
      const [supplierResult, productResult, purchaseResult] = await Promise.all([
        apiRequest('/suppliers', { token }),
        apiRequest('/products?page=1&pageSize=100', { token }),
        apiRequest('/purchases?page=1&pageSize=20', { token }),
      ])
      setSuppliers(supplierResult.items)
      setProducts(productResult.items)
      setPurchases(purchaseResult.items)
      setSupplierId((current) => (
        current || String(supplierResult.items[0]?.id ?? '')
      ))
    } catch (loadError) {
      if (loadError.status === 401) onUnauthorized()
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [token])

  function updateItem(index, field, value) {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  function addItem() {
    setItems((current) => [...current, { productId: '', quantity: '1', unitCost: '' }])
  }

  function removeItem(index) {
    setItems((current) => current.filter((_item, itemIndex) => itemIndex !== index))
  }

  async function createSupplier(event) {
    event.preventDefault()
    setError('')
    try {
      const result = await apiRequest('/suppliers', {
        method: 'POST',
        token,
        body: JSON.stringify({
          name: supplierName,
          taxId: supplierTaxId || null,
        }),
      })
      setSuppliers((current) => [...current, result.item].sort((left, right) => (
        left.name.localeCompare(right.name, 'es')
      )))
      setSupplierId(String(result.item.id))
      setSupplierName('')
      setSupplierTaxId('')
      setShowSupplierForm(false)
      setSuccess('Proveedor creado. Ya puedes registrar su factura.')
    } catch (supplierError) {
      if (supplierError.status === 401) onUnauthorized()
      setError(supplierError.message)
    }
  }

  async function submitPurchase(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const normalizedItems = items.map((item) => ({
      productId: Number(item.productId),
      quantity: Number(item.quantity),
      unitCost: Number(item.unitCost),
    }))
    if (normalizedItems.some((item) => (
      !Number.isInteger(item.productId)
      || !Number.isFinite(item.quantity)
      || item.quantity <= 0
      || !Number.isFinite(item.unitCost)
      || item.unitCost < 0
    ))) {
      setError('Selecciona un producto e indica cantidades y costos válidos para cada línea.')
      return
    }
    if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) {
      setError('Cada producto debe aparecer una sola vez por factura.')
      return
    }

    setIsSaving(true)
    try {
      const result = await apiRequest('/purchases', {
        method: 'POST',
        token,
        body: JSON.stringify({
          supplierId: Number(supplierId),
          invoiceNumber,
          issuedAt: `${issuedAt}T12:00:00-05:00`,
          items: normalizedItems,
        }),
      })
      setInvoiceNumber('')
      setIssuedAt(todayInBogota())
      setItems([{ productId: '', quantity: '1', unitCost: '' }])
      setSuccess(`Factura ${result.item.invoiceNumber} registrada. El stock ya fue actualizado.`)
      await loadData()
      try {
        await onPurchaseSaved()
      } catch (refreshError) {
        setError(`La compra se guardó, pero no se pudo actualizar el resumen: ${refreshError.message}`)
      }
    } catch (purchaseError) {
      if (purchaseError.status === 401) onUnauthorized()
      setError(purchaseError.message)
    } finally {
      setIsSaving(false)
    }
  }

  const total = items.reduce((sum, item) => (
    sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0)
  ), 0)
  const canWrite = user?.roles?.some((role) => ['admin', 'warehouse'].includes(role))

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">ENTRADAS DE INVENTARIO</div>
          <h1>Compras <span className="heading-emoji">↗</span></h1>
          <p>Registra facturas de proveedor y actualiza existencias.</p>
        </div>
        <span className="purchase-role-note">Registrado por {user?.fullName || user?.email}</span>
      </section>

      {(error || success) && (
        <div className={error ? 'api-error' : 'purchase-success'} role={error ? 'alert' : 'status'}>
          <span>{error || success}</span>
          {error && <button onClick={loadData} type="button">Reintentar</button>}
        </div>
      )}

      <section aria-labelledby="new-purchase-title" className="purchase-panel">
        <div className="panel-heading">
          <div>
            <h2 id="new-purchase-title">Registrar factura</h2>
            <p>Los productos y sus existencias se actualizan en una sola operación.</p>
          </div>
          <span className="stat-icon stat-icon-green">＋</span>
        </div>

        {!canWrite ? (
          <p className="purchase-permission-note">Tu rol puede consultar las compras, pero no registrarlas.</p>
        ) : (
          <form className="purchase-form" onSubmit={submitPurchase}>
            <div className="purchase-form-row">
              <label>
                Proveedor
                <select
                  onChange={(event) => setSupplierId(event.target.value)}
                  required
                  value={supplierId}
                >
                  <option value="">Selecciona un proveedor</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              <button
                className="button button-secondary supplier-toggle"
                onClick={() => setShowSupplierForm((visible) => !visible)}
                type="button"
              >
                {showSupplierForm ? 'Cancelar' : '＋ Nuevo proveedor'}
              </button>
              <label>
                Número de factura
                <input
                  maxLength="80"
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="Ej. FE-1042"
                  required
                  value={invoiceNumber}
                />
              </label>
              <label>
                Fecha de factura
                <input
                  onChange={(event) => setIssuedAt(event.target.value)}
                  required
                  type="date"
                  value={issuedAt}
                />
              </label>
            </div>

            <div className="purchase-items-heading">
              <div>
                <h3>Productos de la factura</h3>
                <p>El costo unitario se guarda como costo de compra; no cambia el precio de venta.</p>
              </div>
              <button className="button button-secondary" onClick={addItem} type="button">
                ＋ Agregar producto
              </button>
            </div>

            <div className="purchase-lines">
              {items.map((item, index) => (
                <div className="purchase-line" key={index}>
                  <label className="purchase-product-select">
                    Producto
                    <select
                      onChange={(event) => updateItem(index, 'productId', event.target.value)}
                      required
                      value={item.productId}
                    >
                      <option value="">Selecciona por nombre o referencia</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} · {product.reference} · Stock {product.stock}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cantidad
                    <input
                      min="0.001"
                      onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                      required
                      step="0.001"
                      type="number"
                      value={item.quantity}
                    />
                  </label>
                  <label>
                    Costo unitario (COP)
                    <input
                      min="0"
                      onChange={(event) => updateItem(index, 'unitCost', event.target.value)}
                      required
                      step="0.01"
                      type="number"
                      value={item.unitCost}
                    />
                  </label>
                  <button
                    aria-label={`Quitar línea ${index + 1}`}
                    className="remove-purchase-line"
                    disabled={items.length === 1}
                    onClick={() => removeItem(index)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="purchase-total">
              <span>Total estimado de la factura</span>
              <strong>{money.format(total)}</strong>
            </div>
            <div className="purchase-submit-row">
              <span>La factura y todos sus movimientos se guardan juntos.</span>
              <button className="button button-primary" disabled={isSaving || !suppliers.length || !products.length} type="submit">
                {isSaving ? 'Registrando…' : 'Registrar compra'}
              </button>
            </div>
            {!suppliers.length && (
              <p className="purchase-permission-note">Crea un proveedor antes de registrar la primera factura.</p>
            )}
            {!products.length && !isLoading && (
              <p className="purchase-permission-note">Registra al menos un producto antes de ingresar una compra.</p>
            )}
          </form>
        )}

        {showSupplierForm && canWrite && (
          <form className="inline-supplier-form" onSubmit={createSupplier}>
            <label>
              Nombre del proveedor
              <input
                maxLength="160"
                onChange={(event) => setSupplierName(event.target.value)}
                placeholder="Ej. Distribuidora local"
                required
                value={supplierName}
              />
            </label>
            <label>
              NIT (opcional)
              <input
                maxLength="40"
                onChange={(event) => setSupplierTaxId(event.target.value)}
                placeholder="Ej. 900123456-7"
                value={supplierTaxId}
              />
            </label>
            <button className="button button-primary" type="submit">
              Guardar proveedor
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="purchase-history-title" className="purchase-panel purchase-history">
        <div className="panel-heading">
          <div>
            <h2 id="purchase-history-title">Facturas recientes</h2>
            <p>Historial de entradas registradas en inventario.</p>
          </div>
          <span className="product-count">{purchases.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">FACTURA</th>
                <th scope="col">PROVEEDOR</th>
                <th scope="col">FECHA</th>
                <th scope="col">PRODUCTOS</th>
                <th scope="col">TOTAL</th>
                <th scope="col">REGISTRADA POR</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="6"><strong>Cargando compras…</strong></td></tr>
              ) : purchases.length ? purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td className="price-cell">{purchase.invoiceNumber}</td>
                  <td><span className="category-text">{purchase.supplierName}</span></td>
                  <td className="category-text">
                    {new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(purchase.issuedAt))}
                  </td>
                  <td className="category-text">{purchase.itemCount}</td>
                  <td className="price-cell">{money.format(purchase.total)}</td>
                  <td className="category-text">{purchase.createdBy}</td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan="6">
                    <strong>Aún no hay facturas registradas</strong>
                    <small>Al guardar la primera compra aparecerá aquí.</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
