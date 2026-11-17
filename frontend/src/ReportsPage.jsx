import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})
const quantityFormat = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 3,
})
const percentageFormat = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 2,
})
const pageSize = 50
const classOptions = [
  { value: '', label: 'Todas las clases' },
  { value: 'A', label: 'Clase A · hasta 80%' },
  { value: 'B', label: 'Clase B · hasta 95%' },
  { value: 'C', label: 'Clase C · restante' },
]

function formatDate(value) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeZone: 'America/Bogota',
  }).format(new Date(`${value}T12:00:00-05:00`))
}

function toCsvCell(value) {
  const text = String(value)
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}

export default function ReportsPage({ onUnauthorized, token }) {
  const [summary, setSummary] = useState(null)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [abcClass, setAbcClass] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (abcClass) params.set('class', abcClass)

    async function loadReport() {
      setIsLoading(true)
      setError('')
      try {
        const result = await apiRequest(`/reports/inventory?${params}`, {
          token,
          signal: controller.signal,
        })
        setSummary(result.summary)
        setItems(result.items)
        setTotal(result.total)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadReport()
    return () => controller.abort()
  }, [abcClass, onUnauthorized, page, reloadKey, token])

  function changeClass(value) {
    setAbcClass(value)
    setPage(1)
  }

  async function exportReport() {
    if (!summary || !items.length || isExporting) return
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
        if (abcClass) params.set('class', abcClass)
        const result = await apiRequest(`/reports/inventory?${params}`, { token })
        if (!result.items.length && exportItems.length < result.total) {
          throw new Error('Los productos del reporte cambiaron durante la exportación. Inténtalo de nuevo.')
        }
        exportItems.push(...result.items)
        exportTotal = result.total
        exportPage += 1
      } while (exportItems.length < exportTotal)

      const columns = [
        'Referencia',
        'Producto',
        'Categoría',
        'Existencias',
        'Precio de venta COP',
        'Valor potencial de venta COP',
        'Unidades vendidas últimos 12 meses',
        'Participación de rotación %',
        'Participación acumulada %',
        'Clase ABC',
      ]
      const rows = exportItems.map((item) => [
        item.reference,
        item.name,
        item.category,
        item.stock,
        item.unitPrice,
        item.inventoryValue,
        item.unitsSold,
        item.salesShare,
        item.cumulativeShare,
        item.abcClass,
      ])
      const csv = [columns, ...rows]
        .map((row) => row.map(toCsvCell).join(','))
        .join('\r\n')
      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `smartstock-reporte-abc${abcClass ? `-${abcClass.toLowerCase()}` : ''}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (exportError) {
      if (exportError.status === 401) onUnauthorized()
      setError(`No se pudo exportar el reporte: ${exportError.message}`)
    } finally {
      setIsExporting(false)
    }
  }

  const pageCount = Math.ceil(total / pageSize)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">ANÁLISIS DE INVENTARIO</div>
          <h1>Reportes <span className="heading-emoji">▥</span></h1>
          <p>Valorización a precio de venta y clasificación ABC por rotación.</p>
        </div>
        <button
          className="button button-secondary report-export-button"
          disabled={!summary || !items.length || isExporting}
          onClick={exportReport}
          type="button"
        >
          {isExporting ? 'Preparando CSV…' : 'Exportar CSV'}
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

      <section aria-label="Resumen del reporte" className="stats-grid report-stats">
        <article className="stat-card stat-card-value">
          <div className="stat-topline">
            <span className="stat-label">Valor potencial a precio de venta</span>
            <span className="stat-icon stat-icon-purple">$</span>
          </div>
          <strong className="stat-value">
            {summary ? money.format(summary.potentialSaleValue) : '—'}
          </strong>
          <span className="stat-note">existencias actuales × precio de venta</span>
        </article>
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Productos activos</span>
            <span className="stat-icon stat-icon-green">▤</span>
          </div>
          <strong className="stat-value">{summary?.productCount ?? '—'}</strong>
          <span className="stat-note">en la clasificación</span>
        </article>
        <article className="stat-card">
          <div className="stat-topline">
            <span className="stat-label">Unidades vendidas</span>
            <span className="stat-icon stat-icon-blue">↗</span>
          </div>
          <strong className="stat-value">
            {summary ? quantityFormat.format(summary.unitsSold) : '—'}
          </strong>
          <span className="stat-note">del {summary ? formatDate(summary.periodStart) : '—'} al {summary ? formatDate(summary.periodEnd) : '—'}</span>
        </article>
      </section>

      <div className="report-disclaimer" role="note">
        <strong>Importante:</strong> el valor mostrado es el potencial de venta a precios actuales;
        no representa el costo contable del inventario. ABC ordena unidades vendidas en los últimos
        12 meses: A hasta el 80% acumulado, B hasta el 95% y C el resto. Los artículos sin ventas
        durante el período se clasifican como C.
      </div>

      <section aria-labelledby="inventory-report-title" className="purchase-panel report-panel">
        <div className="panel-heading">
          <div>
            <h2 id="inventory-report-title">Valorización y rotación ABC</h2>
            <p>La tabla se ordena por unidades vendidas durante el período analizado.</p>
          </div>
          <span className="product-count">{total}</span>
        </div>

        <div className="report-toolbar">
          <label>
            <span>Clasificación</span>
            <select onChange={(event) => changeClass(event.target.value)} value={abcClass}>
              {classOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">CLASE</th>
                <th scope="col">PRODUCTO</th>
                <th scope="col">EXISTENCIAS</th>
                <th scope="col">PRECIO VENTA</th>
                <th scope="col">VALOR POTENCIAL</th>
                <th scope="col">UNIDADES VENDIDAS</th>
                <th scope="col">% ROTACIÓN</th>
                <th scope="col">% ACUMULADO</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="8"><strong>Calculando reporte…</strong></td></tr>
              ) : items.length ? items.map((item) => (
                <tr key={item.id}>
                  <td><span className={`abc-class-pill ${item.abcClass}`}>{item.abcClass}</span></td>
                  <td>
                    <div className="waste-reason-cell">
                      <strong>{item.name}</strong>
                      <small>{item.reference} · {item.category}</small>
                    </div>
                  </td>
                  <td className="category-text">{quantityFormat.format(item.stock)}</td>
                  <td className="price-cell">{money.format(item.unitPrice)}</td>
                  <td className="price-cell">{money.format(item.inventoryValue)}</td>
                  <td className="category-text">{quantityFormat.format(item.unitsSold)}</td>
                  <td className="category-text">{percentageFormat.format(item.salesShare)}%</td>
                  <td className="category-text">{percentageFormat.format(item.cumulativeShare)}%</td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan="8">
                    <strong>No hay productos para mostrar</strong>
                    <small>Registra productos o prueba con otra clase ABC.</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer report-history-footer">
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
