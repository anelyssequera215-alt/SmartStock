import { Router } from 'express'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const paymentSchema = z.object({
  paymentStatus: z.enum(['paid', 'pending']),
})

router.use(requireRoles('platform_admin'))

router.get('/companies', async (_request, response) => {
  const result = await pool.query(
    `SELECT c.id::text AS id, c.legal_name AS "companyName", c.nit,
            owner.full_name AS "ownerName", owner.email AS "ownerEmail",
            sub.payment_status AS "paymentStatus", c.created_at AS "createdAt"
     FROM companies c
     JOIN subscriptions sub ON sub.company_id = c.id
     LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.company_id = c.id
     ORDER BY c.created_at DESC, c.id DESC`,
  )
  response.json({ items: result.rows })
})

router.patch('/companies/:id/subscription', async (request, response) => {
  const companyId = request.params.id
  const parsed = paymentSchema.safeParse(request.body)
  if (!/^[1-9]\d*$/.test(companyId) || !parsed.success) {
    throw new ApiError(400, 'La empresa o el estado de pago no son válidos.')
  }

  const item = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT c.id, c.legal_name AS "companyName", c.nit,
              owner.full_name AS "ownerName", owner.email AS "ownerEmail",
              sub.payment_status AS "paymentStatus", c.created_at AS "createdAt"
       FROM companies c
       JOIN subscriptions sub ON sub.company_id = c.id
       LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.company_id = c.id
       WHERE c.id = $1
       FOR UPDATE OF sub`,
      [companyId],
    )
    if (!current.rowCount) throw new ApiError(404, 'No se encontró la empresa.')

    const previousPaymentStatus = current.rows[0].paymentStatus
    await client.query(
      `UPDATE subscriptions SET payment_status = $1 WHERE company_id = $2`,
      [parsed.data.paymentStatus, companyId],
    )
    await client.query(
      `INSERT INTO platform_audit_logs
         (actor_user_id, company_id, action, previous_payment_status, payment_status)
       VALUES ($1, $2, 'subscription.payment_status_updated', $3, $4)`,
      [request.user.id, companyId, previousPaymentStatus, parsed.data.paymentStatus],
    )

    return { ...current.rows[0], paymentStatus: parsed.data.paymentStatus }
  })

  response.json({ item })
})

export default router
