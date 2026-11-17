import { Router } from 'express'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  taxId: z.string().trim().max(40).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal('')),
})

router.get('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const result = await pool.query(
    `SELECT id, name, tax_id AS "taxId", phone, email
     FROM suppliers
     WHERE company_id = $1
     ORDER BY lower(name), id`,
    [request.user.companyId],
  )
  response.json({ items: result.rows })
})

router.post('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const parsed = supplierSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Revisa los datos del proveedor e intenta de nuevo.')
  }

  const { name, taxId, phone, email } = parsed.data
  const result = await pool.query(
    `INSERT INTO suppliers (company_id, name, tax_id, phone, email)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, tax_id AS "taxId", phone, email`,
    [request.user.companyId, name, taxId || null, phone || null, email || null],
  )
  response.status(201).json({ item: result.rows[0] })
})

export default router
