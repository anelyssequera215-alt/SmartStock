const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

export async function apiRequest(path, options = {}) {
  const { token, ...fetchOptions } = options
  const headers = new Headers(fetchOptions.headers)
  headers.set('Accept', 'application/json')

  if (fetchOptions.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      headers,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('No se pudo conectar con SmartStock. Verifica que la API esté ejecutándose.')
  }

  if (response.status === 204) return null

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || `La API respondió con el estado ${response.status}.`)
    error.status = response.status
    throw error
  }

  return payload
}

export async function login(email, password) {
  const result = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

  sessionStorage.setItem('smartstock-token', result.token)
  sessionStorage.setItem('smartstock-user', JSON.stringify(result.user))
  return result
}

export async function registerCompany({
  businessName,
  nit,
  fullName,
  email,
  password,
}) {
  const result = await apiRequest('/auth/register-company', {
    method: 'POST',
    body: JSON.stringify({
      companyName: businessName,
      nit,
      fullName,
      email,
      password,
      planCode: 'complete_monthly',
    }),
  })

  sessionStorage.setItem('smartstock-token', result.token)
  sessionStorage.setItem('smartstock-user', JSON.stringify(result.user))
  return result
}

export function clearSession() {
  sessionStorage.removeItem('smartstock-token')
  sessionStorage.removeItem('smartstock-user')
}
