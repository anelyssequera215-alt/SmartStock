import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const wasteTypes = [
  { value: 'damage', label: 'Avería' },
  { value: 'expiry', label: 'Vencimiento' },
  { value: 'other', label: 'Otro motivo' },
]

const wasteTypeLabels = Object.fromEntries(
  wasteTypes.map(({ value, label }) => [value, label]),
)

const quantityFormat = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 3,
})

function formatDate(value) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function WastesPage({ onUnauthorized, onWasteSaved, token, user }) {
  const [products, setProducts] = useState([])
  const [responsibles, setResponsibles] = useState([])
  const [wastes, setWastes] = useState([])
  const [wasteTotal, setWasteTotal] = useState(0)
  const [wastePage, setWastePage] = useState(1)
  const [wasteType, setWasteType] = useState('damage')
  const [reason, setReason] = useState('')
  const [responsibleUserId, setResponsibleUserId] = useState('')
  const [items, setItems] = useState([{ productId: '', quantity: '1' }])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadData(page = wastePage) {
    setIsLoading(true)
    setError('')
    try {
      const [productResult, responsibleResult, wasteResult] = await Promise.all([
        apiRequest('/products?page=1&pageSize=100', { token }),
        apiRequest('/wastes/responsibles', { token }),
        apiRequest(`/wastes?page=${page}&pageSize=20`, { token }),
      ])
      setProducts(productResult.items)
      setResponsibles(responsibleResult.items)
      setWastes(wasteResult.items)
      setWasteTotal(wasteResult.total)
      setResponsibleUserId((current) => (
        current || String(responsibleResult.items[0]?.id ?? '')
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
  }, [token, wastePage])

  function updateItem(index, field, value) {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  function addItem() {
    setItems((current) => [...current, { productId: '', quantity: '1' }])
  }

  function removeItem(index) {
    setItems((current) => current.filter((_item, itemIndex) => itemIndex !== index))
  }

  async function submitWaste(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    const normalizedItems = items.map((item) => ({
      productId: Number(item.productId),
      quantity: Number(item.quantity),
    }))
    if (normalizedItems.some((item) => (
      !Number.isInteger(item.productId)
      || !Number.isFinite(item.quantity)
      || item.quantity <= 0
    ))) {
      setError('Selecciona un producto e indica una cantidad válida para cada línea.')
      return
    }
    if (new Set(normalizedItems.map((item) => item.productId)).size !== normalizedItems.length) {
      setError('Cada producto debe aparecer una sola vez por registro.')
      return
    }

    setIsSaving(true)
    try {
      const result = await apiRequest('/wastes', {
        method: 'POST',
        token,
        body: JSON.stringify({
          wasteType,
          reason,
          responsibleUserId: Number(responsibleUserId),
          items: normalizedItems,
        }),
      })
      setReason('')
      setItems([{ productId: '', quantity: '1' }])
      setSuccess('Merma registrada. Las existencias se actualizaron y la operación quedó auditada.')
      if (wastePage === 1) {
        await loadData(1)
      } else {
        setWastePage(1)
      }
      try {
        await onWasteSaved()
      } catch (refreshError) {
        setError(`La merma se guardó, pero no se pudo actualizar el inventario: ${refreshError.message}`)
      }
    } catch (saveError) {
      if (saveError.status === 401) onUnauthorized()
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  const canWrite = user?.roles?.some((role) => ['admin', 'warehouse'].includes(role))
  const wastePageCount = Math.ceil(wasteTotal / 20)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">SALIDAS NO COMERCIALES</div>
          <h1>Mermas <span className="heading-emoji">↘</span></h1>
          <p>Registra averías y vencimientos con responsable y trazabilidad.</p>
        </div>
        <span className="purchase-role-note">Registrado por {user?.fullName || user?.email}</span>
      </section>

      {(error || success) && (
        <div className={error ? 'api-error' : 'purchase-success'} role={error ? 'alert' : 'status'}>
          <span>{error || success}</span>
          {error && <button onClick={loadData} type="button">Reintentar</button>}
        </div>
      )}

      <section aria-labelledby="new-waste-title" className="purchase-panel">
        <div className="panel-heading">
          <div>
            <h2 id="new-waste-title">Registrar merma</h2>
            <p>El registro y la salida de existencias se confirman en una sola operación.</p>
          </div>
          <span className="stat-icon stat-icon-amber">−</span>
        </div>

        {!canWrite ? (
          <p className="purchase-permission-note">Tu rol puede consultar las mermas, pero no registrarlas.</p>
        ) : (
          <form className="waste-form" onSubmit={submitWaste}>
            <div className="waste-form-row">
              <label>
                Tipo de merma
                <select onChange={(event) => setWasteType(event.target.value)} value={wasteType}>
                  {wasteTypes.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Responsable
                <select
                  onChange={(event) => setResponsibleUserId(event.target.value)}
                  required
                  value={responsibleUserId}
                >
                  <option value="">Selecciona a la persona responsable</option>
                  {responsibles.map((responsible) => (
                    <option key={responsible.id} value={responsible.id}>
                      {responsible.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="waste-reason-field">
                Motivo o detalle
                <input
                  maxLength="500"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ej. Envase dañado durante el almacenamiento"
                  required
                  value={reason}
                />
              </label>
            </div>

            <div className="purchase-items-heading">
              <div>
                <h3>Productos afectados</h3>
                <p>La cantidad debe estar disponible; nunca se permiten existencias negativas.</p>
              </div>
              <button className="button button-secondary" onClick={addItem} type="button">
                ＋ Agregar producto
              </button>
            </div>

            <div className="purchase-lines">
              {items.map((item, index) => (
                <div className="waste-line" key={index}>
                  <label>
                    Producto
                    <select
                      onChange={(event) => updateItem(index, 'productId', event.target.value)}
                      required
                      value={item.productId}
                    >
                      <option value="">Busca por nombre o referencia</option>
                      {products.map((product) => (
                        <option disabled={product.stock <= 0} key={product.id} value={product.id}>
                          {product.name} · {product.reference} · Disponible {quantityFormat.format(product.stock)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cantidad a dar de baja
                    <input
                      min="0.001"
                      onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                      required
                      step="0.001"
                      type="number"
                      value={item.quantity}
                    />
                  </label>
                  <button
                    aria-label={`Quitar producto ${index + 1}`}
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

            <div className="purchase-submit-row">
              <span>Responsable: {responsibles.find((person) => String(person.id) === responsibleUserId)?.fullName || 'pendiente'} · Movimiento y auditoría inmutables.</span>
              <button
                className="button button-primary"
                disabled={isSaving || !responsibles.length || !products.some((product) => product.stock > 0)}
                type="submit"
              >
                {isSaving ? 'Registrando…' : 'Registrar merma'}
              </button>
            </div>
            {!responsibles.length && !isLoading && (
              <p className="purchase-permission-note">No hay usuarios activos para asignar como responsables.</p>
            )}
            {!products.some((product) => product.stock > 0) && !isLoading && (
              <p className="purchase-permission-note">No hay productos con existencias para dar de baja.</p>
            )}
          </form>
        )}
      </section>

      <section aria-labelledby="waste-history-title" className="purchase-panel purchase-history">
        <div className="panel-heading">
          <div>
            <h2 id="waste-history-title">Historial de mermas</h2>
            <p>Consulta el motivo, los productos, el responsable y quién registró cada baja.</p>
          </div>
          <span className="product-count">{wastes.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">FECHA</th>
                <th scope="col">TIPO Y MOTIVO</th>
                <th scope="col">PRODUCTOS Y CANTIDADES</th>
                <th scope="col">RESPONSABLE</th>
                <th scope="col">REGISTRADA POR</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="5"><strong>Cargando mermas…</strong></td></tr>
              ) : wastes.length ? wastes.map((waste) => (
                <tr key={waste.id}>
                  <td className="category-text">{formatDate(waste.createdAt)}</td>
                  <td>
                    <div className="waste-reason-cell">
                      <strong>{wasteTypeLabels[waste.wasteType] || wasteTypeLabels.other}</strong>
                      <small>{waste.reason}</small>
                    </div>
                  </td>
                  <td>
                    <div className="waste-products-cell">
                      {waste.items.map((item) => (
                        <span key={item.productId}>
                          {item.name} · {item.reference}: <strong>{quantityFormat.format(item.quantity)}</strong>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="category-text">{waste.responsibleName}</td>
                  <td className="category-text">{waste.createdBy}</td>
                </tr>
              )) : (
                <tr>
                  <td className="empty-state" colSpan="5">
                    <strong>Aún no hay mermas registradas</strong>
                    <small>Los registros aparecerán aquí después de confirmar una baja.</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer waste-history-footer">
          <span>
            Mostrando <strong>{wastes.length}</strong> de <strong>{wasteTotal}</strong> registros
          </span>
          <div className="waste-pagination">
            <button
              aria-label="Página anterior"
              className="button button-secondary"
              disabled={wastePage <= 1 || isLoading}
              onClick={() => setWastePage((page) => page - 1)}
              type="button"
            >
              Anterior
            </button>
            <span>{wastePage} / {Math.max(wastePageCount, 1)}</span>
            <button
              aria-label="Página siguiente"
              className="button button-secondary"
              disabled={wastePage >= wastePageCount || isLoading}
              onClick={() => setWastePage((page) => page + 1)}
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
