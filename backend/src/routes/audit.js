import { Router } from 'express'
import { requireRoles } from '../auth.js'
import { pool } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

router.use(requireRoles('admin'))

router.get('/actors', async (request, response) => {
  const result = await pool.query(
    `SELECT DISTINCT u.id::text AS id, u.full_name AS "fullName"
     FROM audit_logs al
     JOIN users u ON u.id = al.actor_user_id AND u.company_id = al.company_id
     WHERE al.company_id = $1
    ORDER BY "fullName" ASC, id ASC`,
    [request.user.companyId],
  )
  response.json({ items: result.rows })
})

router.get('/', async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '25', 10)
  const search = String(request.query.search ?? '').trim().slice(0, 120)
  const action = String(request.query.action ?? '').trim().slice(0, 100)
  const actorId = String(request.query.actorId ?? '').trim()
  const from = String(request.query.from ?? '').trim()
  const to = String(request.query.to ?? '').trim()

  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }
  if (actorId && !/^[1-9]\d{0,18}$/.test(actorId)) {
    throw new ApiError(400, 'El usuario seleccionado no es válido.')
  }
  if ((from && !isDate(from)) || (to && !isDate(to))) {
    throw new ApiError(400, 'Las fechas deben ser válidas y tener formato AAAA-MM-DD.')
  }
  if (from && to && from > to) {
    throw new ApiError(400, 'La fecha inicial no puede ser posterior a la fecha final.')
  }

  const conditions = ['al.company_id = $1']
  const values = [request.user.companyId]
  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`)
    conditions.push(`(
      al.action ILIKE $${values.length} ESCAPE '\\'
      OR al.entity_type ILIKE $${values.length} ESCAPE '\\'
      OR al.entity_id::text ILIKE $${values.length} ESCAPE '\\'
      OR actor.full_name ILIKE $${values.length} ESCAPE '\\'
      OR actor.email ILIKE $${values.length} ESCAPE '\\'
      OR al.details::text ILIKE $${values.length} ESCAPE '\\'
    )`)
  }
  if (action) {
    values.push(action)
    conditions.push(`al.action = $${values.length}`)
  }
  if (actorId) {
    values.push(actorId)
    conditions.push(`al.actor_user_id = $${values.length}`)
  }
  if (from) {
    values.push(from)
    conditions.push(
      `al.occurred_at >= ($${values.length}::date::timestamp AT TIME ZONE 'America/Bogota')`,
    )
  }
  if (to) {
    values.push(to)
    conditions.push(
      `al.occurred_at < (($${values.length}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Bogota')`,
    )
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [count, entries] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total
       FROM audit_logs al
       JOIN users actor ON actor.id = al.actor_user_id AND actor.company_id = al.company_id
       ${where}`,
      values,
    ),
    pool.query(
      `SELECT al.id::text AS id, al.occurred_at AS "occurredAt",
              al.action, al.entity_type AS "entityType",
              al.entity_id::text AS "entityId",
              al.details, actor.id::text AS "actorId",
              actor.full_name AS "actorName", actor.email AS "actorEmail"
       FROM audit_logs al
       JOIN users actor ON actor.id = al.actor_user_id AND actor.company_id = al.company_id
       ${where}
       ORDER BY al.occurred_at DESC, al.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    ),
  ])

  response.json({
    items: entries.rows,
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

export default router
