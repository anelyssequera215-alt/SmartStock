import { Router } from 'express'
import { requireRoles } from '../auth.js'
import { pool } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const movementTypes = new Set(['purchase', 'sale', 'waste', 'adjustment'])

router.get('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '20', 10)
  const movementType = String(request.query.type ?? '').trim()
  const search = String(request.query.search ?? '').trim().slice(0, 120)

  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }
  if (movementType && !movementTypes.has(movementType)) {
    throw new ApiError(400, 'El tipo de movimiento no es válido.')
  }

  const conditions = ['sm.company_id = $1']
  const values = [request.user.companyId]
  if (movementType) {
    values.push(movementType)
    conditions.push(`sm.movement_type = $${values.length}`)
  }
  if (search) {
    values.push(`%${search}%`)
    conditions.push(`(
      p.name ILIKE $${values.length}
      OR p.reference ILIKE $${values.length}
      OR creator.full_name ILIKE $${values.length}
      OR COALESCE(pi.invoice_number, '') ILIKE $${values.length}
      OR COALESCE(supplier.name, '') ILIKE $${values.length}
      OR COALESCE(wr.reason, '') ILIKE $${values.length}
    )`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (page - 1) * pageSize

  const [count, movements] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
       JOIN users creator ON creator.id = sm.created_by AND creator.company_id = sm.company_id
       LEFT JOIN purchase_invoice_items pii
         ON pii.id = sm.purchase_invoice_item_id AND pii.company_id = sm.company_id
       LEFT JOIN purchase_invoices pi
         ON pi.id = pii.purchase_invoice_id AND pi.company_id = sm.company_id
       LEFT JOIN suppliers supplier
         ON supplier.id = pi.supplier_id AND supplier.company_id = sm.company_id
       LEFT JOIN sale_items si ON si.id = sm.sale_item_id AND si.company_id = sm.company_id
       LEFT JOIN sales sale ON sale.id = si.sale_id AND sale.company_id = sm.company_id
       LEFT JOIN waste_record_items wri
         ON wri.id = sm.waste_record_item_id AND wri.company_id = sm.company_id
       LEFT JOIN waste_records wr
         ON wr.id = wri.waste_record_id AND wr.company_id = sm.company_id
       ${where}`,
      values,
    ),
    pool.query(
      `SELECT sm.id, sm.movement_type AS "movementType",
              sm.quantity_delta::text AS "quantityDelta",
              sm.created_at AS "createdAt",
              p.id AS "productId", p.name AS "productName",
              p.reference AS "productReference",
              creator.full_name AS "createdBy",
              pi.invoice_number AS "invoiceNumber",
              supplier.name AS "supplierName",
              sale.id AS "saleId",
              wr.waste_type AS "wasteType", wr.reason AS "wasteReason",
              responsible.full_name AS "responsibleName"
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
       JOIN users creator ON creator.id = sm.created_by AND creator.company_id = sm.company_id
       LEFT JOIN purchase_invoice_items pii
         ON pii.id = sm.purchase_invoice_item_id AND pii.company_id = sm.company_id
       LEFT JOIN purchase_invoices pi
         ON pi.id = pii.purchase_invoice_id AND pi.company_id = sm.company_id
       LEFT JOIN suppliers supplier
         ON supplier.id = pi.supplier_id AND supplier.company_id = sm.company_id
       LEFT JOIN sale_items si ON si.id = sm.sale_item_id AND si.company_id = sm.company_id
       LEFT JOIN sales sale ON sale.id = si.sale_id AND sale.company_id = sm.company_id
       LEFT JOIN waste_record_items wri
         ON wri.id = sm.waste_record_item_id AND wri.company_id = sm.company_id
       LEFT JOIN waste_records wr
         ON wr.id = wri.waste_record_id AND wr.company_id = sm.company_id
       LEFT JOIN users responsible
         ON responsible.id = wr.responsible_user_id AND responsible.company_id = sm.company_id
       ${where}
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    ),
  ])

  response.json({
    items: movements.rows.map((movement) => ({
      ...movement,
      productId: Number(movement.productId),
      quantityDelta: Number(movement.quantityDelta),
      saleId: movement.saleId === null ? null : Number(movement.saleId),
    })),
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

export default router
