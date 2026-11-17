import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

const roleLabels = {
  admin: 'Administrador',
  warehouse: 'Bodega',
  cashier: 'Cajero',
}

const pageSize = 20

function formatDate(value) {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeZone: 'America/Bogota',
  }).format(new Date(value))
}

function UserDialog({
  isSaving,
  onClose,
  onSave,
  roles,
  user,
}) {
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [selectedRoles, setSelectedRoles] = useState(user?.roles ?? [])
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [error, setError] = useState('')

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  function toggleRole(role) {
    setSelectedRoles((current) => (
      current.includes(role)
        ? current.filter((item) => item !== role)
        : [...current, role]
    ))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!selectedRoles.length) {
      setError('Selecciona al menos un rol para el usuario.')
      return
    }
    try {
      if (user) {
        await onSave({
          id: user.id,
          roles: selectedRoles,
          isActive,
        })
      } else {
        await onSave({
          fullName,
          email,
          password,
          roles: selectedRoles,
        })
      }
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="user-dialog-title"
        aria-modal="true"
        className="product-dialog user-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">EQUIPO Y PERMISOS</span>
            <h2 id="user-dialog-title">{user ? 'Editar acceso' : 'Nuevo usuario'}</h2>
            <p>
              {user
                ? 'Los cambios de rol o estado cerrarán las sesiones activas de este usuario.'
                : 'La contraseña inicial debe tener al menos 12 caracteres.'}
            </p>
          </div>
          <button aria-label="Cerrar" className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <form className="user-form" onSubmit={handleSubmit}>
          {user ? (
            <>
              <div className="user-readonly-fields">
                <span><small>Nombre</small><strong>{user.fullName}</strong></span>
                <span><small>Correo</small><strong>{user.email}</strong></span>
              </div>
              <label className="user-active-toggle">
                <input
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  type="checkbox"
                />
                Usuario activo
              </label>
            </>
          ) : (
            <>
              <label>
                Nombre completo
                <input
                  autoFocus
                  maxLength="120"
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  value={fullName}
                />
              </label>
              <label>
                Correo electrónico
                <input
                  autoComplete="email"
                  maxLength="254"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label>
                Contraseña inicial
                <input
                  autoComplete="new-password"
                  maxLength="128"
                  minLength="12"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
                <small className="user-field-help">
                  Compártela de forma segura y solicita al usuario cambiarla después de iniciar sesión.
                </small>
              </label>
            </>
          )}

          <fieldset className="user-role-options">
            <legend>Roles y permisos</legend>
            {roles.map((role) => (
              <label key={role}>
                <input
                  checked={selectedRoles.includes(role)}
                  onChange={() => toggleRole(role)}
                  type="checkbox"
                />
                <span>
                  <strong>{roleLabels[role] || role}</strong>
                  <small>
                    {role === 'admin'
                      ? 'Administra usuarios, productos y configuración.'
                      : role === 'warehouse'
                        ? 'Gestiona inventario, compras, movimientos y mermas.'
                        : role === 'cashier'
                          ? 'Registra ventas y gestiona pedidos en línea.'
                          : 'Compra productos y consulta sus pedidos en la tienda.'}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Cancelar
            </button>
            <button className="button button-primary" disabled={isSaving} type="submit">
              {isSaving ? 'Guardando…' : user ? 'Guardar permisos' : 'Crear usuario'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default function UsersPage({ onUnauthorized, token, user }) {
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialogUser, setDialogUser] = useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)
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
    if (activeFilter) params.set('active', activeFilter)

    async function loadUsers() {
      setIsLoading(true)
      setError('')
      try {
        const [userResult, roleResult] = await Promise.all([
          apiRequest(`/users?${params}`, { token, signal: controller.signal }),
          apiRequest('/users/roles', { token, signal: controller.signal }),
        ])
        setUsers(userResult.items)
        setTotal(userResult.total)
        setRoles(roleResult.items)
      } catch (loadError) {
        if (loadError.name === 'AbortError') return
        if (loadError.status === 401) onUnauthorized()
        setError(loadError.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    loadUsers()
    return () => controller.abort()
  }, [activeFilter, onUnauthorized, page, reloadKey, search, token])

  async function saveUser(userData) {
    setIsSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await apiRequest(
        userData.id ? `/users/${userData.id}` : '/users',
        {
          method: userData.id ? 'PATCH' : 'POST',
          token,
          body: JSON.stringify(userData.id
            ? { roles: userData.roles, isActive: userData.isActive }
            : userData),
        },
      )
      setNotice(userData.id
        ? 'Permisos y estado actualizados. Las sesiones anteriores fueron invalidadas cuando correspondía.'
        : `Usuario ${result.item.fullName} creado. Ya puede iniciar sesión con su contraseña inicial.`)
      setDialogOpen(false)
      setDialogUser(null)
      setReloadKey((current) => current + 1)
    } catch (saveError) {
      if (saveError.status === 401) onUnauthorized()
      throw saveError
    } finally {
      setIsSaving(false)
    }
  }

  function changeActiveFilter(value) {
    setActiveFilter(value)
    setPage(1)
  }

  const pageCount = Math.ceil(total / pageSize)

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRACIÓN DEL EQUIPO</div>
          <h1>Usuarios <span className="heading-emoji">♙</span></h1>
          <p>Administra cuentas, roles y acceso al sistema.</p>
        </div>
        <button
          className="button button-primary user-create-button"
          onClick={() => {
            setDialogUser(null)
            setDialogOpen(true)
          }}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          Nuevo usuario
        </button>
      </section>

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

      <section aria-label="Resumen de usuarios" className="user-summary">
        <div>
          <span className="stat-icon stat-icon-green">♙</span>
          <span><strong>{total}</strong><small>usuarios encontrados</small></span>
        </div>
        <p>Las cuentas desactivadas no pueden iniciar sesión. Todo cambio de acceso queda auditado.</p>
      </section>

      <section aria-labelledby="users-title" className="purchase-panel user-management-panel">
        <div className="panel-heading">
          <div>
            <h2 id="users-title">Equipo y permisos</h2>
            <p>Las sesiones se revocan automáticamente cuando cambian los permisos o el estado.</p>
          </div>
        </div>
        <div className="user-toolbar">
          <label className="search-field">
            <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
              <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6" />
              <path d="m13.2 13.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
            </svg>
            <input
              aria-label="Buscar usuarios"
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nombre o correo..."
              type="search"
              value={searchInput}
            />
          </label>
          <label className="user-status-filter">
            <span className="visually-hidden">Filtrar por estado de usuario</span>
            <select onChange={(event) => changeActiveFilter(event.target.value)} value={activeFilter}>
              <option value="">Todos los estados</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">USUARIO</th>
                <th scope="col">ROLES</th>
                <th scope="col">ESTADO</th>
                <th scope="col">CREADO</th>
                <th scope="col"><span className="visually-hidden">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="empty-state" colSpan="5"><strong>Cargando usuarios…</strong></td></tr>
              ) : users.length ? users.map((item) => {
                const isCurrentUser = String(item.id) === String(user?.id)
                const initials = item.fullName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join('')
                  .toLocaleUpperCase('es')
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="user-table-identity">
                        <span className="user-table-avatar">{initials}</span>
                        <span className="waste-reason-cell">
                          <strong>{item.fullName}{isCurrentUser ? ' (Tú)' : ''}</strong>
                          <small>{item.email}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="user-mobile-field">
                        <small>Roles</small>
                        <div className="user-role-list">
                          {item.roles.map((role) => (
                            <span className={`user-role-tag ${role}`} key={role}>
                              {roleLabels[role] || role}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="user-mobile-field">
                        <small>Estado</small>
                        <span className={`user-status-pill ${item.isActive ? 'active' : 'inactive'}`}>
                          <span />
                          {item.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    </td>
                    <td className="category-text">
                      <div className="user-mobile-field">
                        <small>Creado</small>
                        {formatDate(item.createdAt)}
                      </div>
                    </td>
                    <td>
                      <button
                        className="button button-secondary user-edit-button"
                        disabled={isCurrentUser}
                        onClick={() => {
                          setDialogUser(item)
                          setDialogOpen(true)
                        }}
                        title={isCurrentUser ? 'Administra tus datos desde Mi perfil' : undefined}
                        type="button"
                      >
                        {isCurrentUser ? 'Tu cuenta' : 'Editar acceso'}
                      </button>
                    </td>
                  </tr>
                )
              }) : (
                <tr>
                  <td className="empty-state" colSpan="5">
                    <strong>No encontramos usuarios</strong>
                    <small>Prueba con otro nombre, correo o filtro de estado.</small>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer user-history-footer">
          <span>
            Mostrando <strong>{users.length}</strong> de <strong>{total}</strong> usuarios
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

      {dialogOpen && (
        <UserDialog
          isSaving={isSaving}
          onClose={() => {
            setDialogOpen(false)
            setDialogUser(null)
          }}
          onSave={saveUser}
          roles={roles}
          user={dialogUser}
        />
      )}
    </>
  )
}
