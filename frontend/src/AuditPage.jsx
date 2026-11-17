import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const pageSize = 25
const actionLabels = {
  'product.created': 'Producto creado',
  'product.updated': 'Producto actualizado',
  'product.archived': 'Producto archivado',
  'product.price_changed': 'Precio actualizado',
  'purchase_invoice.created': 'Compra registrada',
  'sale.confirmed': 'Venta confirmada',
  'waste.recorded': 'Merma registrada',
  'stock.adjusted': 'Existencias ajustadas',
  'stock.purchase': 'Entrada por compra',
  'stock.sale': 'Salida por venta',
  'stock.waste': 'Salida por merma',
  'user.created': 'Usuario creado',
  'user.access_updated': 'Acceso de usuario actualizado',
  'user.profile_updated': 'Perfil actualizado',
  'user.password_changed': 'Contraseña cambiada',
  'customer.registered': 'Cliente registrado',
  'customer_order.placed': 'Pedido realizado',
  'customer_order.cancelled': 'Pedido cancelado',
  'customer_order.confirmed': 'Pedido confirmado',
  'customer_order.declined': 'Pedido no disponible',
}
const entityLabels = {
  product: 'Producto',
  purchase_invoice: 'Factura de compra',
  sale: 'Venta',
  waste_record: 'Registro de merma',
  stock_movement: 'Movimiento de inventario',
  user: 'Usuario',
  customer_order: 'Pedido de cliente',
}
const detailLabels = {
  fullName: 'Nombre',
  email: 'Correo',
  roles: 'Roles',
  isActive: 'Cuenta activa',
  sessionsRevoked: 'Sesiones revocadas',
  reference: 'Referencia',
  name: 'Nombre',
  old_price: 'Precio anterior',
  new_price: 'Precio nuevo',
  product_id: 'Producto ID',
  quantity_delta: 'Cambio de existencias',
  movement_type: 'Tipo de movimiento',
  supplierId: 'Proveedor ID',
  invoiceNumber: 'Número de factura',
  itemCount: 'Productos afectados',
  idempotencyKey: 'Clave de venta',
  wasteType: 'Tipo de merma',
  responsibleUserId: 'Responsable ID',
  reason: 'Motivo',
  customerOrderId: 'Pedido de cliente ID',
}
const dateFormat = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function dateToInputValue(date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function formatDate(value) {
  return dateFormat.format(new Date(value))
}

function formatDetailValue(value) {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (Array.isArray(value)) {
    return value.map((item) => actionLabels[item] || roleLabels[item] || item).join(', ')
  }
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

const roleLabels = {
  admin: 'Administrador',
  warehouse: 'Bodega',
  cashier: 'Cajero',
  customer: 'Cliente',
}

function AuditDetails({ details }) {
  const entries = Object.entries(details ?? {})
  if (!entries.length) return <span className="audit-empty-details">Sin detalles adicionales</span>

  return (
    <dl className="audit-detail-list">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{detailLabels[key] || key}</dt>
          <dd>{formatDetailValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function AuditPage({ onUnauthorized, token }) {
  const [entries, setEntries] = useState([])
  const [actors, setActors] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
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
    if (search) params.set('search', search)
    if (actorId) params.set('actorId', actorId)
    if (action) params.set('action', action)
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    async function loadAudit() {
      setIsLoading(true)
      setError('')
      try {
        const [auditResult, actorResult] = await Promise.all([
          apiRequest(`/audit?${params}`, { token, signal: controller.signal }),
          apiRequest('/audit/actors', { token, signal: controller.signal }),
        ])
        setEntries(auditResult.items)
        setTotal(auditResult.total)
        setActors(actorResult.items)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadAudit()
    return () => controller.abort()
  }, [action, actorId, from, onUnauthorized, page, reloadKey, search, to, token])

  function updateFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  function resetFilters() {
    setSearchInput('')
    setSearch('')
    setActorId('')
    setAction('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const pageCount = Math.ceil(total / pageSize)
  const hasFilters = Boolean(searchInput || actorId || action || from || to)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">SEGURIDAD Y TRAZABILIDAD</div>
          <h1>Auditoría <span className="heading-emoji">◷</span></h1>
          <p>Bitácora de operaciones críticas. Los registros son inmutables.</p>
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

      <section aria-labelledby="audit-title" className="purchase-panel audit-panel">
        <div className="panel-heading">
          <div>
            <h2 id="audit-title">Bitácora de eventos</h2>
            <p>Consulta quién realizó cada acción y cuándo quedó registrada.</p>
          </div>
          <span className="product-count">{total}</span>
        </div>

        <div className="audit-toolbar">
          <label className="search-field">
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
              <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
            <input
              aria-label="Buscar en la bitácora"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar acción, usuario o detalle..."
              type="search"
              value={searchInput}
            />
          </label>
          <label>
            <span>Acción</span>
            <select onChange={(event) => updateFilter(setAction, event.target.value)} value={action}>
              <option value="">Todas</option>
              {Object.entries(actionLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Usuario</span>
            <select onChange={(event) => updateFilter(setActorId, event.target.value)} value={actorId}>
              <option value="">Todos</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.fullName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Desde</span>
            <input
              max={to || undefined}
              onChange={(event) => updateFilter(setFrom, event.target.value)}
              type="date"
              value={from}
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              min={from || undefined}
              onChange={(event) => updateFilter(setTo, event.target.value)}
              type="date"
              value={to}
            />
          </label>
          {hasFilters && (
            <button className="button button-secondary audit-reset-button" onClick={resetFilters} type="button">
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">FECHA Y HORA</th>
                <th scope="col">ACCIÓN</th>
                <th scope="col">ENTIDAD</th>
                <th scope="col">USUARIO</th>
                <th scope="col">DETALLES</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="5"><strong>Cargando bitácora…</strong></td></tr>
              ) : entries.length ? entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="category-text audit-date-cell">{formatDate(entry.occurredAt)}</td>
                  <td>
                    <div className="audit-action-cell">
                      <strong>{actionLabels[entry.action] || entry.action}</strong>
                      <small>{entry.action}</small>
                    </div>
                  </td>
                  <td className="audit-entity-cell">
                    <strong>{entityLabels[entry.entityType] || entry.entityType}</strong>
                    <small>ID {entry.entityId}</small>
                  </td>
                  <td>
                    <div className="audit-actor-cell">
                      <strong>{entry.actorName}</strong>
                      <small>{entry.actorEmail}</small>
                    </div>
                  </td>
                  <td><AuditDetails details={entry.details} /></td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan="5">
                    <strong>No encontramos eventos</strong>
                    <small>{hasFilters ? 'Prueba con otros filtros.' : 'Los cambios críticos aparecerán aquí.'}</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer audit-history-footer">
          <span>
            Mostrando <strong>{entries.length}</strong> de <strong>{total}</strong> eventos
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

      <p className="audit-immutability-note">
        La bitácora es de solo lectura: los eventos no pueden editarse ni eliminarse desde SmartStock.
      </p>
    </>
  )
}
