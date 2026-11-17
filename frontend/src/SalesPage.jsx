import { useEffect, useRef, useState } from 'react'
import { apiRequest } from './api.js'

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

function formatSaleDate(value) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function SalesPage({ onSaleSaved, onUnauthorized, token, user }) {
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [recentSales, setRecentSales] = useState([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [isLoadingSales, setIsLoadingSales] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const idempotencyKey = useRef(crypto.randomUUID())

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setIsLoadingProducts(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '30' })
        if (query.trim()) params.set('search', query.trim())
        const result = await apiRequest(`/products?${params}`, {
          token,
          signal: controller.signal,
        })
        setProducts(result.items)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoadingProducts(false)
      }
    }, query.trim() ? 200 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [onUnauthorized, query, token])

  useEffect(() => {
    let active = true
    async function loadRecentSales() {
      setIsLoadingSales(true)
      try {
        const result = await apiRequest('/sales?page=1&pageSize=10', { token })
        if (active) setRecentSales(result.items)
      } catch (loadError) {
        if (active) {
          if (loadError.status === 401) onUnauthorized()
          setError(loadError.message)
        }
      } finally {
        if (active) setIsLoadingSales(false)
      }
    }

    loadRecentSales()
    return () => {
      active = false
    }
  }, [onUnauthorized, token])

  function addToCart(product) {
    if (product.stock <= 0) return
    setError('')
    setSuccess('')
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id)
      if (existing) {
        if (existing.quantity >= product.stock) return current
        return current.map((item) => (
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ))
      }
      return [...current, {
        productId: product.id,
        reference: product.reference,
        name: product.name,
        unitPrice: product.price,
        stock: product.stock,
        quantity: 1,
      }]
    })
  }

  function changeQuantity(productId, nextQuantity) {
    setError('')
    setCart((current) => current.map((item) => (
      item.productId === productId
        ? {
            ...item,
            quantity: Math.min(
              item.stock,
              Math.max(0.001, Number(nextQuantity) || 0.001),
            ),
          }
        : item
    )))
  }

  function removeFromCart(productId) {
    setCart((current) => current.filter((item) => item.productId !== productId))
  }

  async function confirmSale() {
    if (!cart.length || isSaving) return
    setIsSaving(true)
    setError('')
    setSuccess('')
    try {
      const result = await apiRequest('/sales', {
        method: 'POST',
        token,
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          items: cart.map((item) => ({
            productId: Number(item.productId),
            quantity: item.quantity,
          })),
        }),
      })
      setCart([])
      idempotencyKey.current = crypto.randomUUID()
      setSuccess(`Venta #${result.item.id} confirmada por ${money.format(result.item.total)}.`)
      setRecentSales((current) => [
        result.item,
        ...current.filter((sale) => sale.id !== result.item.id),
      ].slice(0, 10))
      try {
        await onSaleSaved()
        const refreshed = await apiRequest(
          `/products?page=1&pageSize=30${query.trim() ? `&search=${encodeURIComponent(query.trim())}` : ''}`,
          { token },
        )
        setProducts(refreshed.items)
      } catch (refreshError) {
        setError(`La venta quedó confirmada, pero no se pudo actualizar la vista: ${refreshError.message}`)
      }
    } catch (saleError) {
      if (saleError.status === 401) onUnauthorized()
      setError(saleError.message)
    } finally {
      setIsSaving(false)
    }
  }

  const total = cart.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const canWrite = user?.roles?.some((role) => ['admin', 'cashier'].includes(role))

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">CAJA Y PUNTO DE VENTA</div>
          <h1>Punto de venta <span className="heading-emoji">◫</span></h1>
          <p>Busca productos, arma la venta y confirma el cobro.</p>
        </div>
        <span className="purchase-role-note">Caja atendida por {user?.fullName || user?.email}</span>
      </section>

      {(error || success) && (
        <div className={error ? 'api-error' : 'purchase-success'} role={error ? 'alert' : 'status'}>
          <span>{error || success}</span>
          {error && <button onClick={() => setError('')} type="button">Cerrar</button>}
        </div>
      )}

      {!canWrite ? (
        <section className="purchase-panel">
          <p className="purchase-permission-note">Tu rol puede consultar el inventario, pero no registrar ventas.</p>
        </section>
      ) : (
        <div className="pos-layout">
          <section aria-labelledby="pos-products-title" className="purchase-panel pos-products-panel">
            <div className="panel-heading">
              <div>
                <h2 id="pos-products-title">Productos</h2>
                <p>Busca por nombre o referencia y agrega artículos a la venta.</p>
              </div>
            </div>
            <label className="search-field pos-search">
              <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6" />
                <path d="m13.2 13.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
              </svg>
              <input
                aria-label="Buscar productos para venta"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar producto o referencia…"
                type="search"
                value={query}
              />
            </label>
            <div className="pos-product-list">
              {isLoadingProducts ? (
                <p className="pos-empty">Buscando productos…</p>
              ) : products.length ? products.map((product) => {
                const outOfStock = product.stock <= 0
                const inCart = cart.find((item) => item.productId === product.id)
                const atCartLimit = inCart && inCart.quantity >= product.stock
                return (
                  <article className="pos-product-card" key={product.id}>
                    <span className="product-thumb mint">{product.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es')}</span>
                    <div className="pos-product-info">
                      <strong>{product.name}</strong>
                      <span>Ref. {product.reference}</span>
                      <small className={outOfStock ? 'pos-stock-empty' : ''}>
                        {outOfStock ? 'Agotado' : `Disponible: ${product.stock}`}
                      </small>
                    </div>
                    <strong className="pos-product-price">{money.format(product.price)}</strong>
                    <button
                      aria-label={`Agregar ${product.name}`}
                      className="pos-add-button"
                      disabled={outOfStock || atCartLimit}
                      onClick={() => addToCart(product)}
                      type="button"
                    >
                      ＋
                    </button>
                  </article>
                )
              }) : (
                <p className="pos-empty">No hay productos que coincidan con la búsqueda.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="pos-cart-title" className="purchase-panel pos-cart-panel">
            <div className="panel-heading">
              <div>
                <h2 id="pos-cart-title">Venta actual <span className="product-count">{cart.length}</span></h2>
                <p>El stock se descuenta al confirmar.</p>
              </div>
              {cart.length > 0 && (
                <button className="pos-clear-button" onClick={() => setCart([])} type="button">
                  Vaciar
                </button>
              )}
            </div>
            {cart.length ? (
              <div className="pos-cart-lines">
                {cart.map((item) => (
                  <article className="pos-cart-line" key={item.productId}>
                    <div className="pos-cart-product">
                      <strong>{item.name}</strong>
                      <span>{money.format(item.unitPrice)} c/u</span>
                    </div>
                    <label className="pos-quantity-label">
                      <span className="visually-hidden">Cantidad de {item.name}</span>
                      <input
                        aria-label={`Cantidad de ${item.name}`}
                        max={item.stock}
                        min="0.001"
                        onChange={(event) => changeQuantity(item.productId, event.target.value)}
                        step="0.001"
                        type="number"
                        value={item.quantity}
                      />
                    </label>
                    <strong className="pos-line-total">{money.format(item.quantity * item.unitPrice)}</strong>
                    <button
                      aria-label={`Quitar ${item.name}`}
                      className="pos-remove-button"
                      onClick={() => removeFromCart(item.productId)}
                      type="button"
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="pos-empty-cart">
                <span aria-hidden="true">＋</span>
                <strong>Tu venta está vacía</strong>
                <p>Agrega productos para calcular el total.</p>
              </div>
            )}
            <div className="pos-total-row">
              <span>Total a cobrar</span>
              <strong>{money.format(total)}</strong>
            </div>
            <button
              className="button button-primary pos-confirm-button"
              disabled={!cart.length || isSaving}
              onClick={confirmSale}
              type="button"
            >
              {isSaving ? 'Confirmando venta…' : 'Confirmar venta'}
            </button>
            <p className="pos-audit-note">La venta queda guardada y auditada. No se permiten saldos negativos.</p>
          </section>
        </div>
      )}

      <section aria-labelledby="recent-sales-title" className="purchase-panel purchase-history pos-history">
        <div className="panel-heading">
          <div>
            <h2 id="recent-sales-title">Ventas recientes</h2>
            <p>Últimas ventas confirmadas en este punto de venta.</p>
          </div>
          <span className="product-count">{recentSales.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">VENTA</th>
                <th scope="col">FECHA</th>
                <th scope="col">PRODUCTOS</th>
                <th scope="col">TOTAL</th>
                <th scope="col">CAJERO</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingSales ? (
                <tr><td className="empty-state" colSpan="5"><strong>Cargando ventas…</strong></td></tr>
              ) : recentSales.length ? recentSales.map((sale) => (
                <tr key={sale.id}>
                  <td className="price-cell">#{sale.id}</td>
                  <td className="category-text">{formatSaleDate(sale.soldAt)}</td>
                  <td className="category-text">{sale.items.length}</td>
                  <td className="price-cell">{money.format(sale.total)}</td>
                  <td className="category-text">{sale.createdBy}</td>
                </tr>
              )) : (
                <tr><td className="empty-state" colSpan="5"><strong>Aún no hay ventas registradas.</strong></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
