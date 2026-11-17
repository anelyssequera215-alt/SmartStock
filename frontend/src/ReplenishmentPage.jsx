import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const quantityFormat = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 3,
})
const pageSize = 50

function toCsvCell(value) {
  const text = String(value)
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

function formatQuantity(value) {
  return quantityFormat.format(value)
}

export default function ReplenishmentPage({
  onGoToPurchases,
  onUnauthorized,
  token,
}) {
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [policy, setPolicy] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [quantityOverrides, setQuantityOverrides] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
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
    if (search) params.set('search', search)

    async function loadRecommendations() {
      setIsLoading(true)
      setError('')
      try {
        const result = await apiRequest(`/replenishment?${params}`, {
          token,
          signal: controller.signal,
        })
        setItems(result.items)
        setSummary(result.summary)
        setPolicy(result.policy)
        setTotal(result.total)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadRecommendations()
    return () => controller.abort()
  }, [onUnauthorized, page, reloadKey, search, token])

  function updateQuantity(productId, value) {
    setQuantityOverrides((current) => ({
      ...current,
      [productId]: value,
    }))
  }

  async function exportDraft() {
    if (!items.length || isExporting) return
    setIsExporting(true)
    setError('')
    try {
      const exportItems = []
      let exportTotal = 0
      let exportPage = 1
      do {
        const params = new URLSearchParams({
          page: String(exportPage),
          pageSize: '100',
        })
        if (search) params.set('search', search)
        const result = await apiRequest(`/replenishment?${params}`, { token })
        if (!result.items.length && exportItems.length < result.total) {
          throw new Error('El inventario cambió durante la exportación. Inténtalo de nuevo.')
        }
        exportItems.push(...result.items)
        exportTotal = result.total
        exportPage += 1
      } while (exportItems.length < exportTotal)

      const normalizedItems = exportItems.map((item) => {
        const quantityText = quantityOverrides[item.id] ?? String(item.recommendedQuantity)
        const quantity = Number(quantityText)
        if (!Number.isFinite(quantity) || quantity <= 0
            || quantity > 99999999999.999
            || !Number.isInteger(quantity * 1000)) {
          throw new Error(`La cantidad para ${item.name} debe ser positiva y tener máximo tres decimales.`)
        }
        return { item, quantity }
      })
      const columns = [
        'Referencia',
        'Producto',
        'Categoría',
        'Existencias actuales',
        'Unidades vendidas últimos 30 días',
        'Unidades vendidas días 31 a 90',
        'Demanda diaria pronosticada',
        'Stock objetivo',
        'Cantidad sugerida',
      ]
      const rows = normalizedItems.map(({ item, quantity }) => [
        item.reference,
        item.name,
        item.category,
        item.stock,
        item.recentUnitsSold,
        item.baselineUnitsSold,
        item.averageDailyDemand,
        item.targetStock,
        quantity,
      ])
      const csv = [columns, ...rows]
        .map((row) => row.map(toCsvCell).join(','))
        .join('\r\n')
      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `smartstock-borrador-reabastecimiento${search ? '-filtrado' : ''}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      if (exportError.status === 401) onUnauthorized()
      setError(`No se pudo exportar el borrador: ${exportError.message}`)
    } finally {
      setIsExporting(false)
    }
  }

  const pageCount = Math.ceil(total / pageSize)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">ASISTENTE DE COMPRAS</div>
          <h1>Reabastecimiento <span className="heading-emoji">✳</span></h1>
          <p>Pronóstico de demanda reciente comparado con el período anterior.</p>
        </div>
        <div className="replenishment-actions">
          <button
            className="button button-secondary"
            disabled={!items.length || isExporting}
            onClick={exportDraft}
            type="button"
          >
            {isExporting ? 'Preparando borrador…' : 'Descargar borrador CSV'}
          </button>
          <button
            className="button button-primary"
            onClick={onGoToPurchases}
            type="button"
          >
            Ir a Compras
          </button>
        </div>
      </section>

      {error && (
        <div className="api-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setReloadKey((current) => current + 1)} type="button">
            Reintentar
          </button>
        </div>
      )}

      <section aria-label="Resumen de reabastecimiento" className="stats-grid replenishment-stats">
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Productos sugeridos</span>
            <span className="stat-icon stat-icon-green">↗</span>
          </div>
          <strong className="stat-value">{summary?.productCount ?? '—'}</strong>
          <span className="stat-note">requieren reposición estimada</span>
        </article>
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Agotados</span>
            <span className="stat-icon stat-icon-amber">!</span>
          </div>
          <strong className="stat-value">{summary?.outOfStockCount ?? '—'}</strong>
          <span className="stat-note">productos sin existencias</span>
        </article>
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Unidades recomendadas</span>
            <span className="stat-icon stat-icon-blue">＋</span>
          </div>
          <strong className="stat-value">
            {summary ? formatQuantity(summary.totalRecommendedQuantity) : '—'}
          </strong>
          <span className="stat-note">antes de ajustar el borrador</span>
        </article>
      </section>

      {policy && (
        <div className="replenishment-policy" role="note">
          <strong>Pronóstico estadístico (no IA entrenada):</strong> pondera{' '}
          {Math.round(policy.recentDemandWeight * 100)}% la demanda de los últimos{' '}
          {policy.recentWindowDays} días y {Math.round(policy.baselineDemandWeight * 100)}% la de los{' '}
          {policy.baselineWindowDays} anteriores. El stock objetivo cubre {policy.leadTimeDays} días de
          entrega estimada más {policy.safetyStockDays} días de seguridad, o el stock mínimo
          configurado si es mayor. No hay plazo real por proveedor ni se descuentan pedidos
          pendientes; confirma las cantidades antes de comprar.
        </div>
      )}

      <section aria-labelledby="replenishment-title" className="purchase-panel replenishment-panel">
        <div className="panel-heading">
          <div>
            <h2 id="replenishment-title">Productos por reabastecer</h2>
            <p>Puedes ajustar la cantidad sugerida antes de descargar el borrador.</p>
          </div>
          <span className="product-count">{total}</span>
        </div>

        <div className="replenishment-toolbar">
          <label className="search-field">
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
              <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
            <input
              aria-label="Buscar productos para reabastecer"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nombre, referencia o categoría..."
              type="search"
              value={searchInput}
            />
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">PRODUCTO</th>
                <th scope="col">EXISTENCIAS</th>
                <th scope="col">VENDIDO 30 / 60 DÍAS</th>
                <th scope="col">DEMANDA PRONOSTICADA</th>
                <th scope="col">STOCK OBJETIVO</th>
                <th scope="col">CANTIDAD SUGERIDA</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="6"><strong>Calculando sugerencias…</strong></td></tr>
              ) : items.length ? items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="waste-reason-cell">
                      <strong>{item.name}</strong>
                      <small>{item.reference} · {item.category}</small>
                    </div>
                  </td>
                  <td className="category-text">{formatQuantity(item.stock)}</td>
                  <td className="category-text">
                    {formatQuantity(item.recentUnitsSold)} / {formatQuantity(item.baselineUnitsSold)}
                  </td>
                  <td className="category-text">{formatQuantity(item.averageDailyDemand)}</td>
                  <td className="category-text">{formatQuantity(item.targetStock)}</td>
                  <td>
                    <label className="replenishment-quantity">
                      <span className="visually-hidden">Cantidad sugerida para {item.name}</span>
                      <input
                        aria-label={`Cantidad sugerida para ${item.name}`}
                        min="0.001"
                        onChange={(event) => updateQuantity(item.id, event.target.value)}
                        step="0.001"
                        type="number"
                        value={quantityOverrides[item.id] ?? String(item.recommendedQuantity)}
                      />
                    </label>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan="6">
                    <strong>
                      {error
                        ? 'No se pudieron cargar las sugerencias'
                        : search
                          ? 'No encontramos productos sugeridos'
                          : 'No hay productos por reabastecer'}
                    </strong>
                    <small>
                      {error
                        ? 'Revisa el mensaje de error e inténtalo de nuevo.'
                        : search
                        ? 'Prueba con otro nombre, referencia o categoría.'
                        : 'Las existencias actuales cubren el objetivo calculado según la rotación.'}
                    </small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer replenishment-history-footer">
          <span>
            Mostrando <strong>{items.length}</strong> de <strong>{total}</strong> productos
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
