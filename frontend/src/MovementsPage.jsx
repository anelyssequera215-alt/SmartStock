import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const movementTypes = [
  { value: '', label: 'Todos los movimientos' },
  { value: 'purchase', label: 'Compras' },
  { value: 'sale', label: 'Ventas' },
  { value: 'waste', label: 'Mermas' },
  { value: 'adjustment', label: 'Ajustes' },
]

const movementLabels = {
  purchase: 'Compra',
  sale: 'Venta',
  waste: 'Merma',
  adjustment: 'Ajuste',
}
const wasteTypeLabels = {
  damage: 'Avería',
  expiry: 'Vencimiento',
  other: 'Otro motivo',
}

const quantityFormat = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 3,
})

function formatDate(value) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getMovementDetail(movement) {
  if (movement.movementType === 'purchase') {
    return `Factura ${movement.invoiceNumber} · ${movement.supplierName}`
  }
  if (movement.movementType === 'sale') {
    return `Venta #${movement.saleId}`
  }
  if (movement.movementType === 'waste') {
    return `${wasteTypeLabels[movement.wasteType] || wasteTypeLabels.other}: ${movement.wasteReason} · Responsable: ${movement.responsibleName}`
  }
  return 'Ajuste manual de existencias'
}

export default function MovementsPage({ onUnauthorized, token }) {
  const [movements, setMovements] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [type, setType] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, searchInput.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (type) params.set('type', type)
    if (search) params.set('search', search)

    async function loadMovements() {
      setIsLoading(true)
      setError('')
      try {
        const result = await apiRequest(`/movements?${params}`, {
          token,
          signal: controller.signal,
        })
        setMovements(result.items)
        setTotal(result.total)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadMovements()
    return () => controller.abort()
  }, [onUnauthorized, page, pageSize, reloadKey, search, token, type])

  function changeType(value) {
    setType(value)
    setPage(1)
  }

  const pageCount = Math.ceil(total / pageSize)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">TRAZABILIDAD DE EXISTENCIAS</div>
          <h1>Movimientos <span className="heading-emoji">⇄</span></h1>
          <p>Consulta entradas, ventas, mermas y ajustes registrados en el inventario.</p>
        </div>
      </section>

      {error && (
        <div className="api-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setReloadKey((current) => current + 1)} type="button">Reintentar</button>
        </div>
      )}

      <section aria-labelledby="movements-title" className="purchase-panel movement-panel">
        <div className="panel-heading">
          <div>
            <h2 id="movements-title">Historial de movimientos</h2>
            <p>El historial es de solo lectura para conservar la trazabilidad.</p>
          </div>
          <span className="product-count">{total}</span>
        </div>

        <div className="movement-toolbar">
          <label className="search-field">
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
              <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
            <input
              aria-label="Buscar movimientos"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Producto, referencia, factura, proveedor o motivo..."
              type="search"
              value={searchInput}
            />
          </label>
          <label className="movement-type-filter">
            <span className="visually-hidden">Filtrar por tipo de movimiento</span>
            <select onChange={(event) => changeType(event.target.value)} value={type}>
              {movementTypes.map((movementType) => (
                <option key={movementType.value} value={movementType.value}>
                  {movementType.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">FECHA</th>
                <th scope="col">MOVIMIENTO</th>
                <th scope="col">PRODUCTO</th>
                <th scope="col">DETALLE</th>
                <th scope="col">CAMBIO DE STOCK</th>
                <th scope="col">REGISTRADO POR</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="6"><strong>Cargando movimientos…</strong></td></tr>
              ) : movements.length ? movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="category-text">{formatDate(movement.createdAt)}</td>
                  <td>
                    <span className={`movement-type-pill ${movement.movementType}`}>
                      {movementLabels[movement.movementType] || 'Movimiento'}
                    </span>
                  </td>
                  <td>
                    <div className="waste-reason-cell">
                      <strong>{movement.productName}</strong>
                      <small>Ref. {movement.productReference}</small>
                    </div>
                  </td>
                  <td className="movement-detail">{getMovementDetail(movement)}</td>
                  <td>
                    <strong className={`movement-quantity ${movement.quantityDelta > 0 ? 'positive' : 'negative'}`}>
                      {movement.quantityDelta > 0 ? '+' : '−'}
                      {quantityFormat.format(Math.abs(movement.quantityDelta))}
                    </strong>
                  </td>
                  <td className="category-text">{movement.createdBy}</td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan="6">
                    <strong>No encontramos movimientos</strong>
                    <small>Prueba con otro término o cambia el filtro seleccionado.</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer movement-history-footer">
          <span>
            Mostrando <strong>{movements.length}</strong> de <strong>{total}</strong> movimientos
          </span>
          <div className="waste-pagination">
            <button
              aria-label="Página anterior"
              className="button button-secondary"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => current - 1)}
              type="button"
            >
              Anterior
            </button>
            <span>{page} / {Math.max(pageCount, 1)}</span>
            <button
              aria-label="Página siguiente"
              className="button button-secondary"
              disabled={page >= pageCount || isLoading}
              onClick={() => setPage((current) => current + 1)}
              type="button"
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
