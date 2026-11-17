import { useEffect, useRef, useState } from 'react'

const roleLabels = {
  admin: 'Administrador',
  warehouse: 'Bodega',
  cashier: 'Cajero',
  platform_admin: 'Administrador de SmartStock',
}

export default function AccountMenu({ onLogout, onOpenProfile, user, variant = 'sidebar' }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef(null)
  const initials = (user?.fullName || user?.email || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('es')

  useEffect(() => {
    function closeMenu(event) {
      if (!rootRef.current?.contains(event.target)) setIsOpen(false)
      if (event.type === 'keydown' && event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeMenu)
    }
  }, [])

  return (
    <div className={`account-menu account-menu-${variant}`} ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Cuenta de ${user?.fullName || user?.email || 'usuario'}`}
        className="account-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span className="profile-avatar">{initials}</span>
        <span className="profile-copy">
          <strong>{user?.fullName || user?.email || 'Usuario'}</strong>
          <small>{user?.roles?.map((role) => roleLabels[role] || role).join(', ') || 'Usuario'}</small>
        </span>
        <span aria-hidden="true" className="account-trigger-chevron">⌄</span>
      </button>
      <button
        aria-label="Cerrar sesión"
        className="account-logout-button"
        onClick={onLogout}
        title="Cerrar sesión"
        type="button"
      >
        <span aria-hidden="true">↪</span>
        <span className="account-logout-label">Cerrar sesión</span>
      </button>
      {isOpen && (
        <div className="account-dropdown" role="menu">
          <div className="account-dropdown-heading">
            <strong>{user?.fullName || 'Mi cuenta'}</strong>
            <span>{user?.email}</span>
          </div>
          <button
            onClick={() => {
              setIsOpen(false)
              onOpenProfile()
            }}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true">◉</span>
            Mi perfil
          </button>
          <button
            className="account-logout-item"
            onClick={() => {
              setIsOpen(false)
              onLogout()
            }}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true">↪</span>
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}
