import { Router } from 'express'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const purchaseSchema = z.object({
  supplierId: z.number().int().positive(),
  invoiceNumber: z.string().trim().min(1).max(80),
  issuedAt: z.iso.datetime({ offset: true }),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().finite().positive().max(99999999999.999),
    unitCost: z.number().finite().min(0).max(999999999999.99),
  })).min(1).max(100).superRefine((items, context) => {
    const seen = new Set()
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'productId'],
          message: 'Un producto solo puede aparecer una vez por factura.',
        })
      }
      seen.add(item.productId)
    })
  }),
})

router.get('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '20', 10)
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }

  const offset = (page - 1) * pageSize
  const [count, invoices] = await Promise.all([
    pool.query(
      'SELECT count(*)::int AS total FROM purchase_invoices WHERE company_id = $1',
      [request.user.companyId],
    ),
    pool.query(
      `SELECT pi.id, pi.invoice_number AS "invoiceNumber",
              pi.issued_at AS "issuedAt", pi.created_at AS "createdAt",
              s.id AS "supplierId", s.name AS "supplierName",
              u.full_name AS "createdBy",
              count(pii.id)::int AS "itemCount",
              COALESCE(sum(pii.quantity * pii.unit_cost), 0)::text AS total
       FROM purchase_invoices pi
       JOIN suppliers s ON s.id = pi.supplier_id AND s.company_id = pi.company_id
       JOIN users u ON u.id = pi.created_by AND u.company_id = pi.company_id
       LEFT JOIN purchase_invoice_items pii
         ON pii.purchase_invoice_id = pi.id AND pii.company_id = pi.company_id
       WHERE pi.company_id = $1
       GROUP BY pi.id, s.id, u.id
       ORDER BY pi.issued_at DESC, pi.id DESC
       LIMIT $2 OFFSET $3`,
      [request.user.companyId, pageSize, offset],
    ),
  ])

  response.json({
    items: invoices.rows.map((invoice) => ({
      ...invoice,
      total: Number(invoice.total),
    })),
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

router.post('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const parsed = purchaseSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Revisa el proveedor, la factura y sus productos.')
  }

  const purchase = parsed.data
  const created = await withTransaction(async (client) => {
    const supplier = await client.query(
      `SELECT id FROM suppliers
       WHERE id = $1 AND company_id = $2 FOR KEY SHARE`,
      [purchase.supplierId, request.user.companyId],
    )
    if (!supplier.rowCount) throw new ApiError(404, 'No se encontró el proveedor.')

    const productIds = purchase.items
      .map((item) => item.productId)
      .sort((left, right) => left - right)
    const lockedProducts = await client.query(
      `SELECT id FROM products
       WHERE id = ANY($1::bigint[]) AND company_id = $2 AND is_active = TRUE
       ORDER BY id FOR UPDATE`,
      [productIds, request.user.companyId],
    )
    if (lockedProducts.rowCount !== productIds.length) {
      throw new ApiError(404, 'Uno o más productos no existen o están archivados.')
    }

    const invoiceResult = await client.query(
      `INSERT INTO purchase_invoices
         (company_id, supplier_id, invoice_number, issued_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, invoice_number AS "invoiceNumber",
                 issued_at AS "issuedAt", created_at AS "createdAt"`,
      [
        request.user.companyId,
        purchase.supplierId,
        purchase.invoiceNumber,
        purchase.issuedAt,
        request.user.id,
      ],
    )
    const invoice = invoiceResult.rows[0]
    const itemResults = []

    for (const item of purchase.items) {
      const invoiceItem = await client.query(
        `INSERT INTO purchase_invoice_items
           (company_id, purchase_invoice_id, product_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, product_id AS "productId",
                   quantity::text AS quantity, unit_cost::text AS "unitCost"`,
        [request.user.companyId, invoice.id, item.productId, item.quantity, item.unitCost],
      )
      const savedItem = invoiceItem.rows[0]

      await client.query(
        `INSERT INTO stock_movements
           (company_id, product_id, movement_type, quantity_delta,
            purchase_invoice_item_id, created_by)
         VALUES ($1, $2, 'purchase', $3, $4, $5)`,
        [request.user.companyId, item.productId, item.quantity, savedItem.id, request.user.id],
      )

      itemResults.push({
        ...savedItem,
        quantity: Number(savedItem.quantity),
        unitCost: Number(savedItem.unitCost),
      })
    }

    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'purchase_invoice.created', $3, $4::jsonb)`,
      [
        request.user.companyId,
        request.user.id,
        invoice.id,
        JSON.stringify({
          supplierId: purchase.supplierId,
          invoiceNumber: invoice.invoiceNumber,
          itemCount: itemResults.length,
        }),
      ],
    )

    return { ...invoice, items: itemResults }
  })

  response.status(201).json({ item: created })
})

export default router
