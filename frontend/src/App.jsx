import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest, clearSession } from './api.js'
import AccountMenu from './AccountMenu.jsx'
import AuditPage from './AuditPage.jsx'
import DashboardPage from './DashboardPage.jsx'
import LoginPage from './LoginPage.jsx'
import MovementsPage from './MovementsPage.jsx'
import NotificationsMenu from './NotificationsMenu.jsx'
import PlatformCompaniesPage from './PlatformCompaniesPage.jsx'
import ProfilePage from './ProfilePage.jsx'
import PurchasesPage from './PurchasesPage.jsx'
import ReplenishmentPage from './ReplenishmentPage.jsx'
import ReportsPage from './ReportsPage.jsx'
import SalesPage from './SalesPage.jsx'
import UsersPage from './UsersPage.jsx'
import WastesPage from './WastesPage.jsx'

const navigation = [
  { label: 'Resumen', icon: '▦', view: 'dashboard', roles: ['admin', 'warehouse', 'cashier'] },
  { label: 'Inventario', icon: '▤', view: 'inventory', roles: ['admin', 'warehouse', 'cashier'] },
  { label: 'Compras', icon: '↗', view: 'purchases', roles: ['admin', 'warehouse'] },
  { label: 'Movimientos', icon: '⇄', view: 'movements', roles: ['admin', 'warehouse'] },
  { label: 'Ventas', icon: '◫', view: 'sales', roles: ['admin', 'cashier'] },
  { label: 'Mermas', icon: '↘', view: 'wastes', roles: ['admin', 'warehouse'] },
  { label: 'Reabastecer', icon: '✳', view: 'replenishment', roles: ['admin', 'warehouse'] },
  { label: 'Reportes', icon: '▥', view: 'reports', roles: ['admin', 'warehouse'] },
  { label: 'Usuarios', icon: '♙', view: 'users', roles: ['admin'] },
  { label: 'Auditoría', icon: '◷', view: 'audit', roles: ['admin'] },
  { label: 'Empresas', icon: '▦', view: 'companies', roles: ['platform_admin'] },
]

const money = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

function getStockState(product) {
  if (product.stock === 0) return { label: 'Agotado', className: 'out' }
  if (product.stock <= product.minimumStock) {
    return { label: 'Stock bajo', className: 'low' }
  }
  return { label: 'Disponible', className: 'available' }
}

function ProductDialog({ isSaving, onClose, onSave, product, products }) {
  const [error, setError] = useState('')

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    const formData = new FormData(event.currentTarget)
    const reference = String(formData.get('reference')).trim()
    const name = String(formData.get('name')).trim()

    if (products.some((item) => (
      item.id !== product?.id
      && item.reference.toLowerCase() === reference.toLowerCase()
    ))) {
      setError('Ya existe un producto con esa referencia.')
      return
    }

    try {
      await onSave({
        ...(product ? { id: product.id } : {}),
        reference,
        name,
        category: String(formData.get('category')),
        stock: Number(formData.get('stock')),
        minimumStock: Number(formData.get('minimumStock')),
        price: Number(formData.get('price')),
      })
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        aria-labelledby="dialog-title"
        aria-modal="true"
        className="product-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">CATÁLOGO</span>
            <h2 id="dialog-title">{product ? 'Editar producto' : 'Nuevo producto'}</h2>
            <p>
              {product
                ? 'Actualiza los datos de este producto.'
                : 'Agrega un producto para llevar el control de sus existencias.'}
            </p>
          </div>
          <button aria-label="Cerrar" className="icon-button" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <form className="product-form" onSubmit={handleSubmit}>
          <label>
            Nombre del producto
            <input autoFocus defaultValue={product?.name ?? ''} maxLength="120" name="name" placeholder="Ej. Café molido" required />
          </label>
          <div className="form-row">
            <label>
              Referencia
              <input defaultValue={product?.reference ?? ''} maxLength="60" name="reference" placeholder="Ej. CAF-001" required />
            </label>
            <label>
              Categoría
              <select defaultValue={product?.category ?? 'Alimentos'} name="category">
                <option>Alimentos</option>
                <option>Aseo</option>
                <option>Bebidas</option>
                <option>Otros</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Precio de venta (COP)
              <input defaultValue={product?.price ?? ''} min="0" name="price" placeholder="0" required step="0.01" type="number" />
            </label>
            <label>
              Existencias
              <input defaultValue={product?.stock ?? ''} min="0" name="stock" placeholder="0" required step="0.001" type="number" />
            </label>
          </div>
          <label>
            Stock mínimo para alertas
            <input defaultValue={product?.minimumStock ?? ''} min="0" name="minimumStock" placeholder="0" required step="0.001" type="number" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="button button-secondary" onClick={onClose} type="button">
              Cancelar
            </button>
            <button className="button button-primary" disabled={isSaving} type="submit">
              {isSaving ? 'Guardando…' : product ? 'Guardar cambios' : 'Guardar producto'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function DeleteConfirmation({ error, isDeleting, onCancel, onConfirm, product }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === 'Escape') onCancel()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])

  return (
    <div className="dialog-backdrop">
      <section
        aria-labelledby="delete-dialog-title"
        aria-modal="true"
        className="product-dialog delete-dialog"
        role="alertdialog"
      >
        <span className="delete-icon" aria-hidden="true">!</span>
        <h2 id="delete-dialog-title">¿Eliminar este producto?</h2>
        <p>
          Se archivará <strong>{product.name}</strong> para conservar el historial de inventario.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="button button-secondary" onClick={onCancel} type="button">
            Cancelar
          </button>
          <button className="button button-danger" disabled={isDeleting} onClick={onConfirm} type="button">
            {isDeleting ? 'Archivando…' : 'Archivar producto'}
          </button>
        </div>
      </section>
    </div>
  )
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('smartstock-token'))
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem('smartstock-user') || 'null')
    } catch {
      return null
    }
  })
  const [products, setProducts] = useState([])
  const [productCount, setProductCount] = useState(0)
  const [summary, setSummary] = useState({
    totalProducts: 0,
    lowStockCount: 0,
    totalUnits: 0,
    inventoryValue: 0,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Todas')
  const [stockFilter, setStockFilter] = useState('Todos')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [activeView, setActiveView] = useState(() => (
    user?.roles?.includes('platform_admin') ? 'companies' : 'dashboard'
  ))

  useEffect(() => {
    if (!token) {
      setProducts([])
      setProductCount(0)
      setSummary({
        totalProducts: 0,
        lowStockCount: 0,
        totalUnits: 0,
        inventoryValue: 0,
      })
      return undefined
    }
    if (activeView !== 'inventory') return undefined

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setIsLoading(true)
      setPageError('')

      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      if (query.trim()) params.set('search', query.trim())
      if (category !== 'Todas') params.set('category', category)
      if (stockFilter === 'Stock bajo') params.set('stock', 'low')
      if (stockFilter === 'Disponible') params.set('stock', 'available')

      try {
        const result = await apiRequest(`/products?${params}`, {
          token,
          signal: controller.signal,
        })
        setProducts(result.items.map((product) => ({
          ...product,
          color: 'mint',
          initials: product.name
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toLocaleUpperCase('es'),
        })))
        setProductCount(result.total)
        setSummary(result.summary)
      } catch (error) {
        if (error.name === 'AbortError') return
        if (error.status === 401) {
          clearSession()
          setToken(null)
          setUser(null)
        }
        setPageError(error.message)
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }, query.trim() ? 250 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [activeView, category, query, stockFilter, token])

  useEffect(() => {
    function focusSearch(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.querySelector('[aria-label="Buscar por nombre o referencia"]')?.focus()
      }
    }

    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('es')

    return products.filter((product) => {
      const matchesQuery = !normalizedQuery
        || product.name.toLocaleLowerCase('es').includes(normalizedQuery)
        || product.reference.toLocaleLowerCase('es').includes(normalizedQuery)
      const matchesCategory = category === 'Todas' || product.category === category
      const isLowStock = product.stock <= product.minimumStock
      const matchesStock = stockFilter === 'Todos'
        || (stockFilter === 'Stock bajo' && isLowStock)
        || (stockFilter === 'Disponible' && !isLowStock)

      return matchesQuery && matchesCategory && matchesStock
    })
  }, [category, products, query, stockFilter])

  const lowStockCount = summary.lowStockCount
  const totalUnits = summary.totalUnits
  const inventoryValue = summary.inventoryValue

  async function saveProduct(product) {
    const initials = product.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toLocaleUpperCase('es')

    setIsSaving(true)
    setPageError('')
    try {
      const result = await apiRequest(
        product.id ? `/products/${product.id}` : '/products',
        {
          method: product.id ? 'PATCH' : 'POST',
          token,
          body: JSON.stringify(product),
        },
      )
      const savedProduct = {
        ...result.item,
        color: 'mint',
        initials,
      }

      if (product.id) {
        setProducts((current) => current.map((item) => (
          item.id === product.id ? savedProduct : item
        )))
      } else {
        setProducts((current) => [savedProduct, ...current])
        setProductCount((current) => current + 1)
      }
      setDialogOpen(false)
      setEditingProduct(null)
      try {
        await refreshProducts()
      } catch (refreshError) {
        setPageError(`El producto se guardó, pero no se pudo actualizar la lista: ${refreshError.message}`)
      }
    } catch (error) {
      if (error.status === 401) {
        clearSession()
        setToken(null)
        setUser(null)
      }
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  async function refreshProducts() {
    const params = new URLSearchParams({ page: '1', pageSize: '100' })
    if (query.trim()) params.set('search', query.trim())
    if (category !== 'Todas') params.set('category', category)
    if (stockFilter === 'Stock bajo') params.set('stock', 'low')
    if (stockFilter === 'Disponible') params.set('stock', 'available')

    const result = await apiRequest(`/products?${params}`, { token })
    setProducts(result.items.map((product) => ({
      ...product,
      color: 'mint',
      initials: product.name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toLocaleUpperCase('es'),
    })))
    setProductCount(result.total)
    setSummary(result.summary)
  }

  async function archiveProduct() {
    setIsDeleting(true)
    setDeleteError('')
    try {
      await apiRequest(`/products/${pendingDelete.id}`, {
        method: 'DELETE',
        token,
      })
      setProducts((current) => current.filter((product) => product.id !== pendingDelete.id))
      setProductCount((current) => Math.max(0, current - 1))
      setPendingDelete(null)
      try {
        await refreshProducts()
      } catch (refreshError) {
        setPageError(`El producto se archivó, pero no se pudo actualizar la lista: ${refreshError.message}`)
      }
    } catch (error) {
      if (error.status === 401) {
        clearSession()
        setToken(null)
        setUser(null)
      }
      setDeleteError(error.message)
    } finally {
      setIsDeleting(false)
    }
  }

  function handleLogin(session) {
    setToken(session.token)
    setUser(session.user)
    setActiveView(session.user.roles.includes('platform_admin') ? 'companies' : 'dashboard')
    setQuery('')
    setCategory('Todas')
    setStockFilter('Todos')
  }

  const handleLogout = useCallback(() => {
    clearSession()
    setToken(null)
    setUser(null)
    setDialogOpen(false)
    setPendingDelete(null)
    setActiveView('dashboard')
  }, [])

  const openProfile = useCallback(() => {
    setActiveView('profile')
  }, [])

  const showLowStock = useCallback(() => {
    setStockFilter('Stock bajo')
    setActiveView('inventory')
  }, [])

  const handleSessionUpdated = useCallback((session) => {
    if (session.token) {
      sessionStorage.setItem('smartstock-token', session.token)
      setToken(session.token)
    }
    if (session.user) {
      sessionStorage.setItem('smartstock-user', JSON.stringify(session.user))
      setUser(session.user)
    }
  }, [])

  function openNewProduct() {
    setEditingProduct(null)
    setDialogOpen(true)
  }

  function exportProducts() {
    const columns = ['Referencia', 'Producto', 'Categoría', 'Existencias', 'Stock mínimo', 'Precio COP']
    const rows = filteredProducts.map((product) => [
      product.reference,
      product.name,
      product.category,
      product.stock,
      product.minimumStock,
      product.price,
    ])
    const csv = [columns, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'smartstock-inventario.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />
  }

  const isPlatformAdmin = user?.roles?.includes('platform_admin')
  const visibleNavigation = navigation.filter((item) => (
    isPlatformAdmin
      ? item.roles?.includes('platform_admin')
      : !item.roles?.includes('platform_admin')
  ))

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a aria-label="SmartStock, inicio" className="brand" href="#">
          <span className="brand-mark">
            <svg aria-hidden="true" fill="none" viewBox="0 0 32 32">
              <path d="M6 10.2 16 5l10 5.2v11.6L16 27l-10-5.2V10.2Z" stroke="currentColor" strokeWidth="2" />
              <path d="m6.5 10.5 9.5 5 9.5-5M16 16v10.5M11 7.7l10 5.2v4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            </svg>
          </span>
          <span className="brand-name">smart<span>stock</span></span>
        </a>

        <div className="workspace-label">ESPACIO DE TRABAJO</div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">
            {(user?.companyName || 'S').trim().slice(0, 1).toLocaleUpperCase('es')}
          </span>
          <span className="workspace-copy">
            <strong>{user?.companyName || (isPlatformAdmin ? 'SmartStock' : 'Mi empresa')}</strong>
            <small>{isPlatformAdmin ? 'Administración de plataforma' : 'Cuenta empresarial'}</small>
          </span>
        </div>

        <nav aria-label="Navegación principal" className="primary-nav">
          <span className="nav-heading">MENÚ</span>
          {visibleNavigation
            .map((item) => {
              const canAccess = !item.roles
                || item.roles.some((role) => user?.roles?.includes(role))
              const restriction = item.roles
                ? `Disponible para ${item.roles.map((role) => ({
                  admin: 'administradores',
                  warehouse: 'bodega',
                  cashier: 'cajeros',
                  platform_admin: 'administradores de SmartStock',
                }[role])).join(', ')}`
                : ''
              const content = (
                <>
                  <span aria-hidden="true" className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {!canAccess && (
                    <span aria-hidden="true" className="nav-restricted-indicator">Restringido</span>
                  )}
                  {item.label === 'Inventario' && (
                    <span className="nav-count">{productCount}</span>
                  )}
                </>
              )

              return canAccess ? (
                <a
                  aria-current={activeView === item.view ? 'page' : undefined}
                  className={`nav-link${activeView === item.view ? ' active' : ''}`}
                  href={`#${item.view}`}
                  key={item.label}
                  onClick={(event) => {
                    event.preventDefault()
                    setActiveView(item.view)
                  }}
                >
                  {content}
                </a>
              ) : (
                <button
                  aria-label={`${item.label}. Sin acceso para tu rol. ${restriction}.`}
                  className="nav-link nav-link-restricted"
                  disabled
                  key={item.label}
                  title={restriction}
                  type="button"
                >
                  {content}
                </button>
              )
            })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="help-card">
          <span className="help-icon">✳</span>
          <strong>¿Necesitas ayuda?</strong>
          <p>Estamos aquí para acompañarte.</p>
          <a href="mailto:hola@smartstock.app">Habla con nosotros <span aria-hidden="true">↗</span></a>
        </div>
      </aside>

      <main className="main-content" id={activeView}>
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Gestión</span>
            <span aria-hidden="true">/</span>
            <strong>
              {activeView === 'dashboard'
                ? 'Resumen'
                : activeView === 'companies'
                  ? 'Empresas'
                  : activeView === 'profile'
                ? 'Mi perfil'
                : activeView === 'purchases'
                ? 'Compras'
                : activeView === 'sales'
                  ? 'Ventas'
                  : activeView === 'movements'
                    ? 'Movimientos'
                    : activeView === 'wastes'
                      ? 'Mermas'
                      : activeView === 'reports'
                        ? 'Reportes'
                        : activeView === 'replenishment'
                          ? 'Reabastecimiento'
                        : activeView === 'users'
                          ? 'Usuarios'
                          : activeView === 'audit'
                            ? 'Auditoría'
                          : 'Inventario'}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-label"><span /> Conectado a la API</span>
            {!isPlatformAdmin && (
              <NotificationsMenu
                onUnauthorized={handleLogout}
                onViewLowStock={showLowStock}
                token={token}
              />
            )}
            <AccountMenu
              onLogout={handleLogout}
              onOpenProfile={openProfile}
              user={user}
              variant="topbar"
            />
          </div>
        </header>

        <div className="page-content">
          {activeView === 'dashboard' ? (
            <DashboardPage
              onNavigate={setActiveView}
              onUnauthorized={handleLogout}
              token={token}
              user={user}
            />
          ) : activeView === 'companies' && isPlatformAdmin ? (
            <PlatformCompaniesPage
              onUnauthorized={handleLogout}
              token={token}
            />
          ) : activeView === 'purchases' ? (
            <PurchasesPage
              onPurchaseSaved={refreshProducts}
              onUnauthorized={handleLogout}
              token={token}
              user={user}
            />
          ) : activeView === 'sales' ? (
            <SalesPage
              onSaleSaved={refreshProducts}
              onUnauthorized={handleLogout}
              token={token}
              user={user}
            />
          ) : activeView === 'wastes' ? (
            <WastesPage
              onUnauthorized={handleLogout}
              onWasteSaved={refreshProducts}
              token={token}
              user={user}
            />
          ) : activeView === 'movements' ? (
            <MovementsPage
              onUnauthorized={handleLogout}
              token={token}
            />
          ) : activeView === 'reports' ? (
            <ReportsPage
              onUnauthorized={handleLogout}
              token={token}
            />
          ) : activeView === 'replenishment' ? (
            <ReplenishmentPage
              onGoToPurchases={() => setActiveView('purchases')}
              onUnauthorized={handleLogout}
              token={token}
            />
          ) : activeView === 'users' ? (
            <UsersPage
              onUnauthorized={handleLogout}
              token={token}
              user={user}
            />
          ) : activeView === 'audit' ? (
            <AuditPage
              onUnauthorized={handleLogout}
              token={token}
            />
          ) : activeView === 'profile' ? (
            <ProfilePage
              onAccountDeleted={handleLogout}
              onSessionUpdated={handleSessionUpdated}
              onUnauthorized={handleLogout}
              token={token}
              user={user}
            />
          ) : (
            <>
          <section className="page-heading">
            <div>
              <div className="eyebrow">TU NEGOCIO, EN ORDEN</div>
              <h1>Inventario <span className="heading-emoji">✳</span></h1>
              <p>Todo lo que tienes, siempre bajo control.</p>
            </div>
            <div className="heading-actions">
              <button className="button button-secondary export-button" onClick={exportProducts} type="button">
                <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                  <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 13.5v2A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
                </svg>
                Exportar
              </button>
              <button className="button button-primary" disabled={!user?.roles?.some((role) => ['admin', 'warehouse'].includes(role))} onClick={openNewProduct} type="button">
                <span aria-hidden="true">＋</span>
                Nuevo producto
              </button>
            </div>
          </section>

          {pageError && (
            <div className="api-error" role="alert">
              <span>{pageError}</span>
              <button onClick={() => refreshProducts().catch((error) => setPageError(error.message))} type="button">
                Reintentar
              </button>
            </div>
          )}

          <section aria-label="Resumen del inventario" className="stats-grid">
            <article className="stat-card">
              <div className="stat-topline">
                <span className="stat-label">Productos registrados</span>
                <span className="stat-icon stat-icon-green">▤</span>
              </div>
              <strong className="stat-value">{summary.totalProducts}</strong>
              <span className="stat-note">en tu catálogo</span>
            </article>
            <article className="stat-card">
              <div className="stat-topline">
                <span className="stat-label">Unidades disponibles</span>
                <span className="stat-icon stat-icon-blue">▧</span>
              </div>
              <strong className="stat-value">{totalUnits.toLocaleString('es-CO')}</strong>
              <span className="stat-note">unidades en bodega</span>
            </article>
            <article className="stat-card">
              <div className="stat-topline">
                <span className="stat-label">Por reabastecer</span>
                <span className="stat-icon stat-icon-amber">↗</span>
              </div>
              <strong className="stat-value">{lowStockCount}</strong>
              <span className="stat-note">productos en nivel bajo</span>
            </article>
            <article className="stat-card stat-card-value">
              <div className="stat-topline">
                <span className="stat-label">Valor del inventario</span>
                <span className="stat-icon stat-icon-purple">$</span>
              </div>
              <strong className="stat-value">{money.format(inventoryValue)}</strong>
              <span className="stat-note">valor estimado a precio de venta</span>
            </article>
          </section>

          {lowStockCount > 0 && (
            <section aria-label="Alerta de stock bajo" className="alert-banner">
              <span className="alert-symbol">!</span>
              <div className="alert-copy">
                <strong>Hay {lowStockCount} productos que necesitan atención</strong>
                <span>Revisa sus existencias y planifica tu próximo pedido.</span>
              </div>
              <button className="alert-link" onClick={() => setStockFilter('Stock bajo')} type="button">
                Ver productos <span aria-hidden="true">→</span>
              </button>
            </section>
          )}

          <section aria-labelledby="products-title" className="inventory-panel">
            <div className="panel-heading">
              <div>
                <h2 id="products-title">Tus productos                 <span className="product-count">{productCount}</span></h2>
                <p>Consulta y administra los productos de tu negocio.</p>
              </div>
              <button aria-label="Más opciones" className="icon-button panel-menu" type="button">···</button>
            </div>

            <div className="toolbar">
              <label className="search-field">
                <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
                  <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.6" />
                  <path d="m13.2 13.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                </svg>
                <input
                  aria-label="Buscar por nombre o referencia"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por nombre o referencia..."
                  type="search"
                  value={query}
                />
                <kbd>Ctrl K</kbd>
              </label>
              <label className="select-filter">
                <span className="filter-label">Categoría</span>
                <select onChange={(event) => setCategory(event.target.value)} value={category}>
                  <option>Todas</option>
                  <option>Alimentos</option>
                  <option>Aseo</option>
                  <option>Bebidas</option>
                  <option>Otros</option>
                </select>
              </label>
              <label className="select-filter status-filter">
                <span className="filter-label">Estado</span>
                <select onChange={(event) => setStockFilter(event.target.value)} value={stockFilter}>
                  <option>Todos</option>
                  <option>Disponible</option>
                  <option>Stock bajo</option>
                </select>
              </label>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">PRODUCTO</th>
                    <th scope="col">CATEGORÍA</th>
                    <th scope="col">EXISTENCIAS</th>
                    <th scope="col">PRECIO</th>
                    <th scope="col">ESTADO</th>
                    <th scope="col"><span className="visually-hidden">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && products.length === 0 ? (
                    <tr><td className="empty-state" colSpan="6"><strong>Cargando inventario…</strong></td></tr>
                  ) : filteredProducts.map((product) => {
                    const status = getStockState(product)

                    return (
                      <tr key={product.id}>
                        <td>
                          <div className="product-cell">
                            <span className={`product-thumb ${product.color}`}>{product.initials}</span>
                            <span className="product-details">
                              <strong>{product.name}</strong>
                              <small>Ref. {product.reference}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className="category-text">{product.category}</span></td>
                        <td>
                          <div className="stock-cell">
                            <strong>{product.stock.toLocaleString('es-CO')}</strong>
                            <span>Mín. {product.minimumStock.toLocaleString('es-CO')}</span>
                          </div>
                        </td>
                        <td className="price-cell">{money.format(product.price)}</td>
                        <td>
                          <span className={`status-pill ${status.className}`}>
                            <span />
                            {status.label}
                          </span>
                        </td>
                        <td>
                          <details className="row-menu">
                            <summary aria-label={`Acciones para ${product.name}`} title={`Actualizado ${product.updatedAt}`}>
                              ···
                            </summary>
                            <div className="row-menu-options">
                              <button
                                onClick={(event) => {
                                  event.currentTarget.closest('details').open = false
                                  setEditingProduct(product)
                                  setDialogOpen(true)
                                }}
                                type="button"
                              >
                                Editar
                              </button>
                              <button
                                className="delete-menu-item"
                                onClick={(event) => {
                                  event.currentTarget.closest('details').open = false
                                  setPendingDelete(product)
                                }}
                                type="button"
                              >
                                Eliminar
                              </button>
                            </div>
                          </details>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td className="empty-state" colSpan="6">
                        <span aria-hidden="true">⌕</span>
                        <strong>No encontramos productos</strong>
                        <small>Prueba con otro nombre, referencia o filtro.</small>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span>Mostrando <strong>{filteredProducts.length}</strong> de <strong>{productCount}</strong> productos</span>
              <span className="updated-note"><span /> {isLoading ? 'Actualizando…' : 'Sincronizado con la API'}</span>
            </div>
          </section>

          <p className="demo-note">
            <span aria-hidden="true">ⓘ</span>
            Los cambios se guardan en PostgreSQL y quedan registrados en la bitácora.
          </p>
            </>
          )}
        </div>
      </main>

      {dialogOpen && (
        <ProductDialog
          isSaving={isSaving}
          onClose={() => setDialogOpen(false)}
          onSave={saveProduct}
          product={editingProduct}
          products={products}
        />
      )}
      {pendingDelete && (
        <DeleteConfirmation
          error={deleteError}
          isDeleting={isDeleting}
          onCancel={() => {
            setPendingDelete(null)
            setDeleteError('')
          }}
          onConfirm={archiveProduct}
          product={pendingDelete}
        />
      )}
    </div>
  )
}

export default App
