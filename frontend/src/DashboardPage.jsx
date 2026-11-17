import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})
const quantity = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 })
const dateFormat = new Intl.DateTimeFormat('es-CO', { weekday: 'short' })
const movementLabels = {
  purchase: 'Entrada',
  sale: 'Venta',
  waste: 'Merma',
  adjustment: 'Ajuste',
}

export default function DashboardPage({ onNavigate, onUnauthorized, token, user }) {
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadDashboard() {
      setIsLoading(true)
      setError('')
      try {
        setData(await apiRequest('/dashboard', {
          token,
          signal: controller.signal,
        }))
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }
    loadDashboard()
    return () => controller.abort()
  }, [onUnauthorized, reloadKey, token])

  const summary = data?.summary
  const maximumSales = Math.max(...(data?.salesByDay ?? []).map((day) => day.total), 1)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">VISIÓN GENERAL</div>
          <h1>Resumen <span className="heading-emoji">▦</span></h1>
          <p>Lo importante de tu inventario y ventas, en un solo lugar.</p>
        </div>
        <button
          className="button button-secondary"
          disabled={isLoading}
          onClick={() => setReloadKey((current) => current + 1)}
          type="button"
        >
          Actualizar
        </button>
      </section>

      {error && (
        <div className="api-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setReloadKey((current) => current + 1)} type="button">
            Reintentar
          </button>
        </div>
      )}

      <section aria-label="Indicadores del negocio" className="stats-grid dashboard-stats">
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Productos activos</span>
            <span className="stat-icon stat-icon-green">▤</span>
          </div>
          <strong className="stat-value">{summary ? summary.productCount : '—'}</strong>
          <span className="stat-note">en el catálogo</span>
        </article>
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Stock bajo o agotado</span>
            <span className="stat-icon stat-icon-amber">!</span>
          </div>
          <strong className="stat-value">{summary ? summary.lowStockCount : '—'}</strong>
          <span className="stat-note">{summary ? summary.outOfStockCount : '—'} agotados</span>
        </article>
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Ventas de hoy</span>
            <span className="stat-icon stat-icon-blue">↗</span>
          </div>
          <strong className="stat-value">
            {data ? money.format(data.salesByDay[data.salesByDay.length - 1]?.total ?? 0) : '—'}
          </strong>
          <span className="stat-note">
            {data
              ? `últimos 7 días: ${money.format(data.salesByDay.reduce((total, day) => total + day.total, 0))}`
              : '—'}
          </span>
        </article>
        <article className="stat-card stat-card-value">
          <div className="stat-topline">
            <span className="stat-label">Valor a precio de venta</span>
            <span className="stat-icon stat-icon-purple">$</span>
          </div>
          <strong className="stat-value">{summary ? money.format(summary.inventoryValue) : '—'}</strong>
          <span className="stat-note">estimado, no valor contable</span>
        </article>
      </section>

      <div className="dashboard-content-grid">
        <section aria-labelledby="dashboard-sales-title" className="inventory-panel dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2 id="dashboard-sales-title">Ventas recientes</h2>
              <p>Ventas confirmadas de los últimos siete días.</p>
            </div>
          </div>
          {isLoading && !data ? (
            <div className="dashboard-empty">Cargando ventas…</div>
          ) : data?.salesByDay?.length ? (
            <div aria-label="Ventas diarias" className="dashboard-chart" role="img">
              {data.salesByDay.map((day) => (
                <div className="dashboard-chart-column" key={day.date} title={`${day.date}: ${money.format(day.total)}`}>
                  <strong>{money.format(day.total)}</strong>
                  <span className="dashboard-chart-track">
                    <span style={{ height: `${Math.max((day.total / maximumSales) * 100, day.total ? 6 : 0)}%` }} />
                  </span>
                  <small>{dateFormat.format(new Date(`${day.date}T12:00:00`))}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              {error ? 'No se pudieron cargar las ventas.' : 'Aún no hay ventas confirmadas.'}
            </div>
          )}
        </section>

        <section aria-labelledby="dashboard-movements-title" className="inventory-panel dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2 id="dashboard-movements-title">Actividad reciente</h2>
              <p>Últimos movimientos de inventario.</p>
            </div>
            {user?.roles?.some((role) => ['admin', 'warehouse'].includes(role)) && (
              <button className="text-action" onClick={() => onNavigate('movements')} type="button">
                Ver movimientos
              </button>
            )}
          </div>
          {data?.recentMovements?.length ? (
            <ul className="dashboard-activity-list">
              {data.recentMovements.map((movement) => (
                <li key={movement.id}>
                  <span className={`dashboard-movement-dot dashboard-movement-${movement.type}`} />
                  <span className="dashboard-activity-copy">
                    <strong>{movementLabels[movement.type] || movement.type}: {movement.productName}</strong>
                    <small>{movement.reference} · {movement.actorName}</small>
                  </span>
                  <span className={movement.quantityDelta > 0 ? 'dashboard-quantity-in' : 'dashboard-quantity-out'}>
                    {movement.quantityDelta > 0 ? '+' : ''}{quantity.format(movement.quantityDelta)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dashboard-empty">
              {error ? 'No se pudo cargar la actividad.' : isLoading ? 'Cargando actividad…' : 'Aún no hay movimientos.'}
            </div>
          )}
        </section>

        <section aria-labelledby="dashboard-products-title" className="inventory-panel dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2 id="dashboard-products-title">Más vendidos</h2>
              <p>Unidades vendidas en los últimos 30 días.</p>
            </div>
          </div>
          {data?.topProducts?.length ? (
            <ol className="dashboard-top-products">
              {data.topProducts.map((product, index) => (
                <li key={product.reference}>
                  <span className="dashboard-product-rank">{index + 1}</span>
                  <span className="dashboard-activity-copy">
                    <strong>{product.name}</strong>
                    <small>{product.reference} · {money.format(product.revenue)}</small>
                  </span>
                  <span className="dashboard-product-units">{quantity.format(product.unitsSold)} u.</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="dashboard-empty">
              {error ? 'No se pudieron cargar los productos.' : isLoading ? 'Cargando productos…' : 'Aún no hay ventas en este período.'}
            </div>
          )}
        </section>

        <section aria-labelledby="dashboard-actions-title" className="inventory-panel dashboard-panel dashboard-shortcuts">
          <div className="panel-heading">
            <div>
              <h2 id="dashboard-actions-title">Accesos rápidos</h2>
              <p>Continúa con las tareas más comunes.</p>
            </div>
          </div>
          <button onClick={() => onNavigate('inventory')} type="button"><span>▤</span> Consultar inventario <b>→</b></button>
          <button onClick={() => onNavigate('sales')} type="button"><span>◫</span> Registrar una venta <b>→</b></button>
          {user?.roles?.some((role) => ['admin', 'warehouse'].includes(role)) && (
            <button onClick={() => onNavigate('replenishment')} type="button"><span>✳</span> Revisar reabastecimiento <b>→</b></button>
          )}
        </section>
      </div>
    </>
  )
}
