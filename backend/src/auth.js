import 'dotenv/config'
import jwt from 'jsonwebtoken'
import { pool } from './db.js'
import { ApiError } from './errors.js'

const jwtSecret = process.env.JWT_SECRET

if (!jwtSecret || jwtSecret.length < 32 || /REEMPLAZA|CHANGE_ME|TODO/i.test(jwtSecret)) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en backend/.env.')
}

export function requireAuth(request, _response, next) {
  const authorization = request.get('authorization')
  const [scheme, token] = authorization?.split(' ') ?? []

  if (scheme !== 'Bearer' || !token) {
    next(new ApiError(401, 'Debes iniciar sesión para realizar esta acción.'))
    return
  }

  let claims
  try {
    claims = jwt.verify(token, jwtSecret)
    if (typeof claims !== 'object' || !claims.sub || !Array.isArray(claims.roles)) {
      throw new Error('Token sin los datos de usuario requeridos.')
    }
  } catch {
    next(new ApiError(401, 'La sesión venció o no es válida. Inicia sesión nuevamente.'))
    return
  }

  pool.query(
    `SELECT u.auth_version, u.company_id AS "companyId",
            c.legal_name AS "companyName", c.is_active AS "companyActive",
            COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 AND u.is_active = TRUE
     GROUP BY u.id, c.id`,
    [claims.sub],
  ).then((result) => {
    const user = result.rows[0]
    const tokenVersion = Number.isInteger(claims.ver) ? claims.ver : 0
    if (!user || user.auth_version !== tokenVersion
        || user.roles.includes('customer')
        || (user.roles.includes('platform_admin')
          ? user.companyId !== null
          : (!user.companyId || user.companyActive !== true))) {
      next(new ApiError(401, 'La sesión ya no es válida. Inicia sesión nuevamente.'))
      return
    }

    request.user = {
      id: claims.sub,
      companyId: user.companyId,
      companyName: user.companyName,
      roles: user.roles,
    }
    next()
  }).catch(next)
}

export function signAccessToken(user) {
  return jwt.sign(
    { roles: user.roles, ver: user.auth_version ?? user.authVersion ?? 0 },
    jwtSecret,
    {
      subject: String(user.id),
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    },
  )
}

export function requireRoles(...allowedRoles) {
  return (request, _response, next) => {
    if (!request.user.roles.some((role) => allowedRoles.includes(role))) {
      next(new ApiError(403, 'Tu rol no tiene permiso para realizar esta acción.'))
      return
    }
    next()
  }
}
