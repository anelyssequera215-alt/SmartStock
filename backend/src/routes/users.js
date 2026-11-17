import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const roleNames = ['admin', 'warehouse', 'cashier']
const userSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  roles: z.array(z.enum(roleNames)).min(1).max(roleNames.length)
    .refine((roles) => new Set(roles).size === roles.length),
})
const updateSchema = z.object({
  roles: z.array(z.enum(roleNames)).min(1).max(roleNames.length)
    .refine((roles) => new Set(roles).size === roles.length),
  isActive: z.boolean(),
})

router.use(requireRoles('admin'))

router.get('/roles', async (_request, response) => {
  const result = await pool.query(
    `SELECT name FROM roles
     WHERE name = ANY($1::text[]) ORDER BY id`,
    [roleNames],
  )
  response.json({ items: result.rows.map((role) => role.name) })
})

router.get('/', async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '20', 10)
  const search = String(request.query.search ?? '').trim().slice(0, 120)
  const activeFilter = String(request.query.active ?? '').trim()
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }
  if (activeFilter && !['true', 'false'].includes(activeFilter)) {
    throw new ApiError(400, 'El filtro de estado no es válido.')
  }

  const conditions = ['u.company_id = $1']
  const values = [request.user.companyId]
  if (search) {
    values.push(`%${search}%`)
    conditions.push(`(u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`)
  }
  if (activeFilter) {
    values.push(activeFilter === 'true')
    conditions.push(`u.is_active = $${values.length}`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [count, users] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total FROM users u ${where}`,
      values,
    ),
    pool.query(
      `SELECT u.id::text AS id, u.full_name AS "fullName", u.email,
              u.is_active AS "isActive", u.created_at AS "createdAt",
              COALESCE(
                array_agg(r.name ORDER BY r.id) FILTER (WHERE r.name IS NOT NULL),
                '{}'
              ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    ),
  ])
  response.json({
    items: users.rows,
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

router.post('/', async (request, response) => {
  const parsed = userSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Escribe un nombre, correo, contraseña de al menos 12 caracteres y uno o más roles válidos.',
    )
  }

  const userData = parsed.data
  const passwordHash = await bcrypt.hash(userData.password, 12)
  const created = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [73190524])
    const inserted = await client.query(
      `INSERT INTO users (company_id, full_name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text AS id, full_name AS "fullName", email,
                 is_active AS "isActive", created_at AS "createdAt"`,
      [request.user.companyId, userData.fullName, userData.email.toLowerCase(), passwordHash],
    )
    const user = inserted.rows[0]
    const roleResult = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = ANY($2::text[])
       RETURNING role_id`,
      [user.id, userData.roles],
    )
    if (roleResult.rowCount !== userData.roles.length) {
      throw new ApiError(400, 'Uno o más roles seleccionados no están disponibles.')
    }
    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user.created', 'user', $3, $4::jsonb)`,
      [
        request.user.companyId,
        request.user.id,
        user.id,
        JSON.stringify({
          fullName: user.fullName,
          email: user.email,
          roles: userData.roles,
        }),
      ],
    )
    return { ...user, roles: userData.roles }
  })

  response.status(201).json({ item: created })
})

router.patch('/:id', async (request, response) => {
  const userId = request.params.id
  if (!/^[1-9]\d*$/.test(userId)) {
    throw new ApiError(400, 'El identificador del usuario no es válido.')
  }
  const parsed = updateSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Selecciona al menos un rol y un estado válido.')
  }
  if (String(request.user.id) === userId) {
    throw new ApiError(409, 'No puedes cambiar tus propios roles o desactivar tu cuenta.')
  }

  const updated = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [73190524])
    const currentResult = await client.query(
      `SELECT id::text AS id, full_name AS "fullName", email,
              is_active AS "isActive", created_at AS "createdAt"
       FROM users WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [userId, request.user.companyId],
    )
    if (!currentResult.rowCount) throw new ApiError(404, 'No se encontró el usuario.')
    const current = currentResult.rows[0]
    const currentRoles = await client.query(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
      JOIN users u ON u.id = ur.user_id
      WHERE ur.user_id = $1 AND u.company_id = $2 ORDER BY r.id`,
      [userId, request.user.companyId],
    )
    current.roles = currentRoles.rows.map((role) => role.name)

    const roles = await client.query(
      'SELECT name, id FROM roles WHERE name = ANY($1::text[]) ORDER BY id',
      [parsed.data.roles],
    )
    if (roles.rowCount !== parsed.data.roles.length) {
      throw new ApiError(400, 'Uno o más roles seleccionados no están disponibles.')
    }

    const currentIsAdmin = current.roles.includes('admin')
    const willBeAdmin = parsed.data.roles.includes('admin') && parsed.data.isActive
    if (currentIsAdmin && !willBeAdmin) {
      const activeAdmins = await client.query(
        `SELECT count(*)::int AS total
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE u.company_id = $1 AND u.is_active = TRUE AND r.name = 'admin'`,
        [request.user.companyId],
      )
      if (activeAdmins.rows[0].total <= 1) {
        throw new ApiError(409, 'No puedes desactivar o quitar el rol al único administrador activo.')
      }
    }

    const changed = current.isActive !== parsed.data.isActive
      || current.roles.length !== parsed.data.roles.length
      || current.roles.some((role) => !parsed.data.roles.includes(role))
    await client.query(
      `UPDATE users SET is_active = $1, auth_version = auth_version + $2
       WHERE id = $3 AND company_id = $4`,
      [parsed.data.isActive, changed ? 1 : 0, userId, request.user.companyId],
    )
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId])
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = ANY($2::text[])`,
      [userId, parsed.data.roles],
    )
    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'user.access_updated', 'user', $3, $4::jsonb)`,
      [
        request.user.companyId,
        request.user.id,
        userId,
        JSON.stringify({
          roles: parsed.data.roles,
          isActive: parsed.data.isActive,
          sessionsRevoked: changed,
        }),
      ],
    )
    return { ...current, roles: parsed.data.roles, isActive: parsed.data.isActive }
  })

  response.json({ item: updated })
})

export default router
