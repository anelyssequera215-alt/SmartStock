import { useEffect, useState } from 'react'
import { apiRequest } from './api.js'

function initialsFor(user) {
  return (user?.fullName || user?.email || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('es')
}

const roleLabels = {
  admin: 'Administrador',
  warehouse: 'Bodega',
  cashier: 'Cajero',
  platform_admin: 'Administrador de SmartStock',
}

export default function ProfilePage({ onAccountDeleted, onSessionUpdated, onUnauthorized, token, user }) {
  const [fullName, setFullName] = useState(user?.fullName || '')
  const [email, setEmail] = useState(user?.email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [deletionPassword, setDeletionPassword] = useState('')
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const [deletionError, setDeletionError] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    apiRequest('/auth/me', { token })
      .then(({ user: profile }) => {
        if (!active) return
        setFullName(profile.fullName)
        setEmail(profile.email)
        onSessionUpdated({ user: profile })
      })
      .catch((error) => {
        if (!active) return
        if (error.status === 401) onUnauthorized()
        setProfileError(error.message)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [onSessionUpdated, onUnauthorized, token])

  async function saveProfile(event) {
    event.preventDefault()
    setIsSavingProfile(true)
    setProfileError('')
    setProfileMessage('')
    try {
      const result = await apiRequest('/auth/me', {
        method: 'PATCH',
        token,
        body: JSON.stringify({ fullName, email }),
      })
      setFullName(result.user.fullName)
      setEmail(result.user.email)
      onSessionUpdated({ user: result.user })
      setProfileMessage('Perfil actualizado correctamente.')
    } catch (error) {
      if (error.status === 401) onUnauthorized()
      setProfileError(error.message)
    } finally {
      setIsSavingProfile(false)
    }
  }

  async function changePassword(event) {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (newPassword !== confirmPassword) {
      setPasswordError('La confirmación no coincide con la nueva contraseña.')
      return
    }
    setIsChangingPassword(true)
    try {
      const session = await apiRequest('/auth/change-password', {
        method: 'POST',
        token,
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      onSessionUpdated(session)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('Contraseña actualizada. Tu sesión actual continúa activa y las sesiones anteriores se cerraron.')
    } catch (error) {
      if (error.status === 401) onUnauthorized()
      setPasswordError(error.message)
    } finally {
      setIsChangingPassword(false)
    }
  }

  async function deleteAccount(event) {
    event.preventDefault()
    setDeletionError('')
    setIsDeletingAccount(true)
    try {
      await apiRequest('/auth/me', {
        method: 'DELETE',
        token,
        body: JSON.stringify({
          password: deletionPassword,
          confirmation: deletionConfirmation,
        }),
      })
      onAccountDeleted()
    } catch (error) {
      if (error.status === 401) onUnauthorized()
      setDeletionError(error.message)
    } finally {
      setIsDeletingAccount(false)
    }
  }

  const canDeleteAccount = user?.roles?.length === 1 && user.roles[0] === 'customer'

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">CONFIGURACIÓN DE CUENTA</div>
          <h1>Mi perfil <span className="heading-emoji">◉</span></h1>
          <p>Administra tus datos personales y protege el acceso a tu cuenta.</p>
        </div>
      </section>

      {isLoading ? (
        <section className="purchase-panel profile-loading">Cargando tu perfil…</section>
      ) : (
        <div className="profile-page-grid">
          <section aria-label="Resumen de cuenta" className="purchase-panel profile-summary">
            <span className="profile-summary-avatar">{initialsFor(user)}</span>
            <h2>{user?.fullName || fullName}</h2>
            <p>{user?.email || email}</p>
            <div className="profile-role-list">
              {(user?.roles || []).map((role) => (
                <span className="profile-role-pill" key={role}>
                  {roleLabels[role] || role}
                </span>
              ))}
            </div>
            <span className="profile-security-note">
              <span aria-hidden="true">✓</span>
              Cuenta protegida con contraseña cifrada
            </span>
          </section>

          <div className="profile-forms">
            <section aria-labelledby="profile-details-title" className="purchase-panel profile-form-panel">
              <div className="panel-heading">
                <div>
                  <h2 id="profile-details-title">Datos personales</h2>
                  <p>Actualiza el nombre y correo asociados a tu cuenta.</p>
                </div>
              </div>
              <form className="product-form" onSubmit={saveProfile}>
                <label>
                  Nombre completo
                  <input
                    autoComplete="name"
                    maxLength="120"
                    minLength="2"
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
                {profileError && <p className="form-error" role="alert">{profileError}</p>}
                {profileMessage && <p className="profile-success" role="status">{profileMessage}</p>}
                <div className="profile-form-actions">
                  <button className="button button-primary" disabled={isSavingProfile} type="submit">
                    {isSavingProfile ? 'Guardando…' : 'Guardar perfil'}
                  </button>
                </div>
              </form>
            </section>

            <section aria-labelledby="profile-password-title" className="purchase-panel profile-form-panel">
              <div className="panel-heading">
                <div>
                  <h2 id="profile-password-title">Cambiar contraseña</h2>
                  <p>Al cambiarla, se cerrarán las demás sesiones de esta cuenta.</p>
                </div>
              </div>
              <form className="product-form" onSubmit={changePassword}>
                <label>
                  Contraseña actual
                  <input
                    autoComplete="current-password"
                    maxLength="128"
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    required
                    type="password"
                    value={currentPassword}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Nueva contraseña
                    <input
                      autoComplete="new-password"
                      maxLength="128"
                      minLength="12"
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                      type="password"
                      value={newPassword}
                    />
                  </label>
                  <label>
                    Confirmar nueva contraseña
                    <input
                      autoComplete="new-password"
                      maxLength="128"
                      minLength="12"
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                      type="password"
                      value={confirmPassword}
                    />
                  </label>
                </div>
                <span className="profile-field-note">Usa al menos 12 caracteres.</span>
                {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
                {passwordMessage && <p className="profile-success" role="status">{passwordMessage}</p>}
                <div className="profile-form-actions">
                  <button className="button button-primary" disabled={isChangingPassword} type="submit">
                    {isChangingPassword ? 'Actualizando…' : 'Actualizar contraseña'}
                  </button>
                </div>
              </form>
            </section>
            {canDeleteAccount && (
              <section aria-labelledby="profile-delete-title" className="purchase-panel profile-form-panel profile-delete-panel">
                <div className="panel-heading">
                  <div>
                    <h2 id="profile-delete-title">Eliminar cuenta</h2>
                    <p>
                      Esta acción es permanente. Solo podremos eliminar la cuenta si no tiene pedidos,
                      operaciones ni registros de auditoría asociados.
                    </p>
                  </div>
                </div>
                <form className="product-form" onSubmit={deleteAccount}>
                  <label>
                    Contraseña actual
                    <input
                      autoComplete="current-password"
                      maxLength="128"
                      onChange={(event) => setDeletionPassword(event.target.value)}
                      required
                      type="password"
                      value={deletionPassword}
                    />
                  </label>
                  <label>
                    Escribe ELIMINAR para confirmar
                    <input
                      autoComplete="off"
                      onChange={(event) => setDeletionConfirmation(event.target.value)}
                      required
                      value={deletionConfirmation}
                    />
                  </label>
                  {deletionError && <p className="form-error" role="alert">{deletionError}</p>}
                  <div className="profile-form-actions">
                    <button className="button button-danger" disabled={isDeletingAccount} type="submit">
                      {isDeletingAccount ? 'Eliminando cuenta…' : 'Eliminar mi cuenta'}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  )
}
