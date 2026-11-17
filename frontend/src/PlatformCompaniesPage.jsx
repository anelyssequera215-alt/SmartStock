import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

const dateFormat = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeZone: 'America/Bogota',
})

export default function PlatformCompaniesPage({ onUnauthorized, token }) {
  const [companies, setCompanies] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function loadCompanies() {
      setIsLoading(true)
      setError('')
      try {
        const result = await apiRequest('/platform/companies', {
          token,
          signal: controller.signal,
        })
        setCompanies(result.items)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadCompanies()
    return () => controller.abort()
  }, [onUnauthorized, reloadKey, token])

  async function updatePayment(company, paymentStatus) {
    setUpdatingId(company.id)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest(`/platform/companies/${company.id}/subscription`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ paymentStatus }),
      })
      setCompanies((current) => current.map((item) => (
        item.id === company.id ? result.item : item
      )))
      setNotice(
        paymentStatus === 'paid'
          ? `Pago de ${company.companyName} marcado como recibido.`
          : `Pago de ${company.companyName} quedó pendiente.`,
      )
    } catch (updateError) {
      if (updateError.status === 401) onUnauthorized()
      setError(updateError.message)
    } finally {
      setUpdatingId('')
    }
  }

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRACIÓN DE SMARTSTOCK</div>
          <h1>Empresas <span className="heading-emoji">▦</span></h1>
          <p>Consulta las cuentas registradas y actualiza manualmente el estado de pago.</p>
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

      <div className="report-disclaimer" role="note">
        El plan SmartStock Completo cuesta {money.format(69900)} al mes. El acceso a la plataforma
        es inmediato; esta pantalla registra los pagos manualmente y no procesa cobros.
      </div>

      {(error || notice) && (
        <div className={error ? 'api-error' : 'purchase-success'} role={error ? 'alert' : 'status'}>
          <span>{error || notice}</span>
          {error && (
            <button onClick={() => setReloadKey((current) => current + 1)} type="button">
              Reintentar
            </button>
          )}
        </div>
      )}

      <section aria-labelledby="platform-companies-title" className="purchase-panel platform-companies-panel">
        <div className="panel-heading">
          <div>
            <h2 id="platform-companies-title">Cuentas de empresa</h2>
            <p>El registro crea una empresa independiente con sus propios datos operativos.</p>
          </div>
          <span className="product-count">{companies.length}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">EMPRESA</th>
                <th scope="col">ADMINISTRADOR</th>
                <th scope="col">PLAN</th>
                <th scope="col">PAGO</th>
                <th scope="col">REGISTRO</th>
                <th scope="col"><span className="visually-hidden">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="6"><strong>Cargando empresas…</strong></td></tr>
              ) : companies.length ? companies.map((company) => {
                const isPaid = company.paymentStatus === 'paid'
                return (
                  <tr key={company.id}>
                    <td>
                      <div className="user-mobile-field">
                        <strong>{company.companyName}</strong>
                        <small>NIT {company.nit}</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-mobile-field">
                        <strong>{company.ownerName}</strong>
                        <small>{company.ownerEmail}</small>
                      </div>
                    </td>
                    <td>
                      <div className="user-mobile-field">
                        <strong>Completo</strong>
                        <small>{money.format(company.monthlyPrice ?? 69900)} / mes</small>
                      </div>
                    </td>
                    <td>
                      <span className={`user-status-pill ${isPaid ? 'active' : 'inactive'}`}>
                        <span />
                        {isPaid ? 'Pagado' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="category-text">{dateFormat.format(new Date(company.createdAt))}</td>
                    <td>
                      <button
                        className={`button ${isPaid ? 'button-secondary' : 'button-primary'}`}
                        disabled={Boolean(updatingId)}
                        onClick={() => updatePayment(company, isPaid ? 'pending' : 'paid')}
                        type="button"
                      >
                        {updatingId === company.id
                          ? 'Guardando…'
                          : isPaid
                            ? 'Marcar pendiente'
                            : 'Registrar pago'}
                      </button>
                    </td>
                  </tr>
                )
              }) : (
                <tr>
                  <td className="empty-state" colSpan="6">
                    <strong>No hay empresas registradas.</strong>
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
