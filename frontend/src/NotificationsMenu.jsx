import { useEffect, useRef, useState } from 'react'
import { apiRequest } from './api.js'

export default function NotificationsMenu({ onUnauthorized, onViewLowStock, token }) {
  const [isOpen, setIsOpen] = useState(false)
  const [data, setData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const rootRef = useRef(null)

  useEffect(() => {
    function closeMenu(event) {
      if (event.type === 'keydown' && event.key === 'Escape') setIsOpen(false)
      if (event.type === 'pointerdown' && !rootRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeMenu)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined
    const controller = new AbortController()

    async function loadNotifications() {
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

    loadNotifications()
    return () => controller.abort()
  }, [isOpen, onUnauthorized, reloadKey, token])

  const lowStockCount = Number(data?.summary?.lowStockCount ?? 0)
  const notificationCount = lowStockCount

  return (
    <div className="notifications-menu" ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={notificationCount
          ? `Notificaciones, ${notificationCount} pendientes`
          : 'Notificaciones'}
        className="notification-button"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
        </svg>
        {notificationCount > 0 && (
          <span aria-hidden="true" className="notification-count">
            {notificationCount > 99 ? '99+' : notificationCount}
          </span>
        )}
      </button>
      {isOpen && (
        <section aria-label="Notificaciones" className="notifications-panel" role="dialog">
          <div className="notifications-heading">
            <div>
              <strong>Notificaciones</strong>
              <span>{notificationCount} pendientes</span>
            </div>
            <button
              aria-label="Cerrar notificaciones"
              className="icon-button"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          {isLoading ? (
            <p className="notifications-empty">Cargando notificaciones…</p>
          ) : error ? (
            <div className="notifications-error">
              <p role="alert">{error}</p>
              <button onClick={() => setReloadKey((current) => current + 1)} type="button">
                Reintentar
              </button>
            </div>
          ) : notificationCount === 0 ? (
            <p className="notifications-empty">No tienes notificaciones pendientes.</p>
          ) : (
            <div className="notifications-list">
              {lowStockCount > 0 && (
                <button
                  className="notification-item"
                  onClick={() => {
                    setIsOpen(false)
                    onViewLowStock()
                  }}
                  type="button"
                >
                  <span className="notification-item-icon notification-item-warning">!</span>
                  <span>
                    <strong>{lowStockCount} productos con stock bajo o agotado</strong>
                    <small>Revisa las existencias del inventario.</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
