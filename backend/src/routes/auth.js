import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { pool, withTransaction } from '../db.js'
import { requireAuth, signAccessToken } from '../auth.js'
import { ApiError } from '../errors.js'

const router = Router()
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
})
const companyRegistrationSchema = z.object({
  companyName: z.string().trim().min(2).max(200),
  nit: z.string().trim().min(3).max(40),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  planCode: z.literal('complete_monthly'),
})
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Inténtalo de nuevo más tarde.' },
})
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados registros. Inténtalo de nuevo más tarde.' },
})
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' },
})
const accountDeletionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' },
})

router.post('/register-company', registrationLimiter, async (request, response) => {
  const parsed = companyRegistrationSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Revisa los datos de la empresa y usa una contraseña de al menos 12 caracteres.')
  }

  const registration = parsed.data
  const passwordHash = await bcrypt.hash(registration.password, 12)
  let user
  try {
    user = await withTransaction(async (client) => {
      const company = await client.query(
        `INSERT INTO companies (legal_name, nit)
         VALUES ($1, $2)
         RETURNING id, legal_name AS "companyName"`,
        [registration.companyName, registration.nit],
      )
      const companyId = company.rows[0].id
      await client.query(
        `INSERT INTO subscriptions (company_id, plan_code, payment_status)
         VALUES ($1, 'complete_monthly', 'pending')`,
        [companyId],
      )
      const inserted = await client.query(
        `INSERT INTO users (company_id, full_name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name AS "fullName", email, auth_version AS "authVersion"`,
        [companyId, registration.fullName, registration.email.toLowerCase(), passwordHash],
      )
      const owner = inserted.rows[0]
      const role = await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, id FROM roles WHERE name = 'admin'`,
        [owner.id],
      )
      if (!role.rowCount) {
        throw new Error('No existe el rol admin. Ejecuta primero la migración de base de datos.')
      }
      await client.query('UPDATE companies SET owner_user_id = $1 WHERE id = $2', [owner.id, companyId])
      return {
        ...owner,
        companyId,
        companyName: company.rows[0].companyName,
        roles: ['admin'],
      }
    })
  } catch (error) {
    if (error.code === '23505') {
      throw new ApiError(409, 'Ya existe una empresa con ese NIT o una cuenta con ese correo.')
    }
    throw error
  }

  response.status(201).json({
    token: signAccessToken(user),
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      roles: user.roles,
      companyId: user.companyId,
      companyName: user.companyName,
    },
  })
})

router.post('/login', loginLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Escribe un correo y una contraseña válidos.')
  }

  const email = parsed.data.email.toLowerCase()
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.password_hash, u.auth_version,
            u.company_id AS "companyId", c.legal_name AS "companyName",
            c.is_active AS "companyActive",
            COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE lower(u.email) = $1 AND u.is_active = TRUE
     GROUP BY u.id, c.id`,
    [email],
  )
  const user = result.rows[0]

  if (!user || user.roles.includes('customer')
      || (user.roles.includes('platform_admin')
        ? user.companyId !== null
        : (!user.companyId || user.companyActive !== true))
      || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
    throw new ApiError(401, 'Correo o contraseña incorrectos.')
  }

  response.json({
    token: signAccessToken(user),
    user: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      roles: user.roles,
      companyId: user.companyId,
      companyName: user.companyName,
    },
  })
})

router.use(requireAuth)

router.get('/me', async (request, response) => {
  const result = await pool.query(
    `SELECT u.id, u.full_name AS "fullName", u.email,
            u.company_id AS "companyId", c.legal_name AS "companyName",
            COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u
     LEFT JOIN companies c ON c.id = u.company_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 AND u.company_id IS NOT DISTINCT FROM $2 AND u.is_active = TRUE
     GROUP BY u.id, c.id`,
    [request.user.id, request.user.companyId],
  )
  if (!result.rowCount) throw new ApiError(404, 'No se encontró el usuario.')
  response.json({ user: result.rows[0] })
})

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
})

router.patch('/me', async (request, response) => {
  const parsed = profileSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Escribe un nombre y un correo válidos.')
  }

  const profile = parsed.data
  const updated = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users SET full_name = $1, email = $2
       WHERE id = $3 AND company_id = $4 AND is_active = TRUE
       RETURNING id, full_name AS "fullName", email`,
      [profile.fullName, profile.email.toLowerCase(), request.user.id, request.user.companyId],
    )
    if (!result.rowCount) throw new ApiError(404, 'No se encontró el usuario.')

    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user.profile_updated', 'user', $2, $3::jsonb)`,
      [
        request.user.companyId,
        request.user.id,
        JSON.stringify({ fullName: profile.fullName, email: profile.email.toLowerCase() }),
      ],
    )

    const roles = await client.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND EXISTS (
         SELECT 1 FROM users u WHERE u.id = ur.user_id AND u.company_id = $2
       ) ORDER BY r.name`,
      [request.user.id, request.user.companyId],
    )
    return {
      ...result.rows[0],
      companyId: request.user.companyId,
      companyName: request.user.companyName,
      roles: roles.rows.map((role) => role.name),
    }
  })

  response.json({ user: updated })
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
})

router.post('/change-password', passwordChangeLimiter, async (request, response) => {
  const parsed = passwordSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'La nueva contraseña debe tener entre 12 y 128 caracteres.')
  }

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    throw new ApiError(400, 'La nueva contraseña debe ser diferente a la actual.')
  }

  const changed = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT id, full_name AS "fullName", email, password_hash, auth_version
       FROM users WHERE id = $1 AND company_id = $2 AND is_active = TRUE FOR UPDATE`,
      [request.user.id, request.user.companyId],
    )
    if (!current.rowCount) throw new ApiError(404, 'No se encontró el usuario.')
    if (!(await bcrypt.compare(parsed.data.currentPassword, current.rows[0].password_hash))) {
      throw new ApiError(400, 'La contraseña actual es incorrecta.')
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)
    const updated = await client.query(
      `UPDATE users SET password_hash = $1, auth_version = auth_version + 1
       WHERE id = $2 AND company_id = $3
       RETURNING id, full_name AS "fullName", email, auth_version`,
      [passwordHash, request.user.id, request.user.companyId],
    )
    const roles = await client.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1 AND EXISTS (
         SELECT 1 FROM users u WHERE u.id = ur.user_id AND u.company_id = $2
       ) ORDER BY r.name`,
      [request.user.id, request.user.companyId],
    )
    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user.password_changed', 'user', $2, '{}'::jsonb)`,
      [request.user.companyId, request.user.id],
    )

    return {
      ...updated.rows[0],
      roles: roles.rows.map((role) => role.name),
    }
  })

  response.json({
    token: signAccessToken(changed),
    user: {
      id: changed.id,
      fullName: changed.fullName,
      email: changed.email,
      roles: changed.roles,
      companyId: request.user.companyId,
      companyName: request.user.companyName,
    },
  })
})

const accountDeletionSchema = z.object({
  password: z.string().min(1).max(128),
  confirmation: z.literal('ELIMINAR'),
})

router.delete('/me', accountDeletionLimiter, async (request, response) => {
  const parsed = accountDeletionSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Confirma la eliminación escribiendo ELIMINAR y tu contraseña actual.')
  }

  try {
    await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT id, password_hash FROM users
         WHERE id = $1 AND is_active = TRUE
         FOR UPDATE`,
        [request.user.id],
      )
      if (!current.rowCount) throw new ApiError(404, 'No se encontró el usuario.')
      if (!(await bcrypt.compare(parsed.data.password, current.rows[0].password_hash))) {
        throw new ApiError(400, 'La contraseña actual es incorrecta.')
      }

      const roles = await client.query(
        `SELECT array_agg(r.name ORDER BY r.name) AS names
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [request.user.id],
      )
      if (roles.rows[0].names?.length !== 1 || roles.rows[0].names[0] !== 'customer') {
        throw new ApiError(403, 'La eliminación desde el perfil está disponible solo para cuentas de cliente.')
      }

      const history = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM audit_logs WHERE actor_user_id = $1)
           OR EXISTS (SELECT 1 FROM customer_orders WHERE customer_user_id = $1)
           OR EXISTS (SELECT 1 FROM purchase_invoices WHERE created_by = $1)
           OR EXISTS (SELECT 1 FROM sales WHERE created_by = $1)
           OR EXISTS (
             SELECT 1 FROM waste_records
             WHERE responsible_user_id = $1 OR created_by = $1
           )
           OR EXISTS (SELECT 1 FROM stock_movements WHERE created_by = $1)
           AS has_history`,
        [request.user.id],
      )
      if (history.rows[0].has_history) {
        throw new ApiError(
          409,
          'No se puede eliminar esta cuenta porque tiene pedidos u operaciones asociadas. Contacta al administrador.',
        )
      }

      await client.query('DELETE FROM user_roles WHERE user_id = $1', [request.user.id])
      await client.query('DELETE FROM users WHERE id = $1', [request.user.id])
    })
  } catch (error) {
    if (error.code === '23503') {
      throw new ApiError(
        409,
        'No se puede eliminar esta cuenta porque tiene operaciones asociadas. Contacta al administrador.',
      )
    }
    throw error
  }

  response.status(204).end()
})

export default router
