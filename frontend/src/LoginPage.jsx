import { useState } from 'react'
import { login, registerCompany } from './api.js'

export default function LoginPage({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [businessName, setBusinessName] = useState('')
  const [nit, setNit] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      onLogin(isRegistering
        ? await registerCompany({ businessName, nit, fullName, email, password })
        : await login(email, password))
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-card">
        <a aria-label="SmartStock, inicio" className="brand login-brand" href="/">
          <span className="brand-mark">
            <svg aria-hidden="true" fill="none" viewBox="0 0 32 32">
              <path d="M6 10.2 16 5l10 5.2v11.6L16 27l-10-5.2V10.2Z" stroke="currentColor" strokeWidth="2" />
              <path d="m6.5 10.5 9.5 5 9.5-5M16 16v10.5M11 7.7l10 5.2v4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </span>
          <span className="brand-name">smart<span>stock</span></span>
        </a>
        <div className="eyebrow">{isRegistering ? 'GESTIÓN PARA TU EMPRESA' : 'TU NEGOCIO, EN ORDEN'}</div>
        <h1 id="login-title">{isRegistering ? 'Registra tu empresa' : 'Qué bueno verte'}</h1>
        <p className="login-description">
          {isRegistering
            ? 'Administra inventario, compras, proveedores y ventas desde un solo lugar.'
            : 'Inicia sesión para gestionar el inventario y la operación de tu empresa.'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          {isRegistering && (
            <>
              <label>
                Nombre de la empresa
                <input
                  autoComplete="organization"
                  autoFocus
                  maxLength="160"
                  minLength="2"
                  onChange={(event) => setBusinessName(event.target.value)}
                  required
                  value={businessName}
                />
              </label>
              <label>
                NIT
                <input
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength="20"
                  minLength="5"
                  onChange={(event) => setNit(event.target.value)}
                  placeholder="Ej. 900123456-7"
                  required
                  value={nit}
                />
              </label>
              <label>
                Nombre del administrador
                <input
                  autoComplete="name"
                  maxLength="120"
                  minLength="2"
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  value={fullName}
                />
              </label>
            </>
          )}
          <label>
            Correo electrónico
            <input
              autoComplete="username"
              autoFocus={!isRegistering}
              maxLength="254"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@negocio.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Contraseña
            <span className="password-input-wrap">
              <input
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                maxLength="128"
                minLength={isRegistering ? '12' : undefined}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Tu contraseña"
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                className="password-visibility-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </span>
          </label>
          {isRegistering && (
            <label className="signup-plan-card">
              <input checked name="plan" readOnly type="radio" value="complete_monthly" />
              <div>
                <strong>Plan SmartStock Completo</strong>
                <span>Inventario, POS, compras, proveedores y reabastecimiento.</span>
              </div>
              <strong className="signup-plan-price">$69.900 <small>COP / mes</small></strong>
              <p>Acceso inmediato. El pago y la activación de la suscripción se gestionan manualmente.</p>
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary login-submit" disabled={isSubmitting} type="submit">
            {isSubmitting
              ? (isRegistering ? 'Creando empresa…' : 'Validando…')
              : (isRegistering ? 'Crear cuenta de empresa' : 'Iniciar sesión')}
          </button>
        </form>
        <p className="login-footer">
          {isRegistering ? '¿Ya tienes cuenta?' : '¿Tu empresa aún no tiene cuenta?'}
          {' '}
          <button
            className="login-mode-toggle"
            onClick={() => {
              setIsRegistering((current) => !current)
              setError('')
            }}
            type="button"
          >
            {isRegistering ? 'Inicia sesión' : 'Registra tu empresa'}
          </button>
        </p>
      </section>
    </main>
  )
}
