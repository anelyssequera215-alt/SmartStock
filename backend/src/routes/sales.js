import { Router } from 'express'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const saleSchema = z.object({
  idempotencyKey: z.uuid(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().finite().positive().max(99999999999.999),
  })).min(1).max(100).superRefine((items, context) => {
    const seen = new Set()
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'productId'],
          message: 'Un producto solo puede aparecer una vez por venta.',
        })
      }
      seen.add(item.productId)
    })
  }),
})

async function loadSale(queryable, id, companyId) {
  const result = await queryable.query(
    `SELECT s.id, s.status, s.sold_at AS "soldAt",
            s.idempotency_key AS "idempotencyKey",
            u.full_name AS "createdBy",
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'productId', si.product_id,
                  'reference', p.reference,
                  'name', p.name,
                  'quantity', si.quantity,
                  'unitPrice', si.unit_price,
                  'lineTotal', si.quantity * si.unit_price
                )
                ORDER BY si.id
              ) FILTER (WHERE si.id IS NOT NULL),
              '[]'::jsonb
            ) AS items,
            COALESCE(sum(si.quantity * si.unit_price), 0)::text AS total
     FROM sales s
     JOIN users u ON u.id = s.created_by AND u.company_id = s.company_id
     LEFT JOIN sale_items si ON si.sale_id = s.id AND si.company_id = s.company_id
     LEFT JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id
     WHERE s.id = $1 AND s.company_id = $2
     GROUP BY s.id, u.id`,
    [id, companyId],
  )
  if (!result.rowCount) return null
  const sale = result.rows[0]
  return {
    ...sale,
    total: Number(sale.total),
    items: sale.items.map((item) => ({
      ...item,
      productId: Number(item.productId),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
  }
}

router.get('/', requireRoles('admin', 'cashier'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '20', 10)
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }

  const [count, result] = await Promise.all([
    pool.query(
      "SELECT count(*)::int AS total FROM sales WHERE company_id = $1 AND status = 'confirmed'",
      [request.user.companyId],
    ),
    pool.query(
      `SELECT id FROM sales
       WHERE company_id = $1 AND status = 'confirmed'
       ORDER BY sold_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [request.user.companyId, pageSize, (page - 1) * pageSize],
    ),
  ])
  const items = await Promise.all(
    result.rows.map((sale) => loadSale(pool, sale.id, request.user.companyId)),
  )

  response.json({
    items,
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

router.post('/', requireRoles('admin', 'cashier'), async (request, response) => {
  const parsed = saleSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Revisa los productos y las cantidades de la venta.')
  }

  const saleRequest = parsed.data
  const result = await withTransaction(async (client) => {
    const insertedSale = await client.query(
      `INSERT INTO sales (company_id, status, sold_at, created_by, idempotency_key)
       VALUES ($1, 'confirmed', now(), $2, $3)
       ON CONFLICT (company_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [request.user.companyId, request.user.id, saleRequest.idempotencyKey],
    )

    if (!insertedSale.rowCount) {
      const existing = await client.query(
        `SELECT id, created_by FROM sales
         WHERE company_id = $1 AND idempotency_key = $2`,
        [request.user.companyId, saleRequest.idempotencyKey],
      )
      if (!existing.rowCount || String(existing.rows[0].created_by) !== String(request.user.id)) {
        throw new ApiError(409, 'La clave de esta venta ya fue utilizada.')
      }
      return {
        sale: await loadSale(client, existing.rows[0].id, request.user.companyId),
        replayed: true,
      }
    }

    const saleId = insertedSale.rows[0].id
    const productIds = saleRequest.items
      .map((item) => item.productId)
      .sort((left, right) => left - right)
    const lockedProducts = await client.query(
      `SELECT id, name, reference, stock_quantity::text AS stock
       FROM products
       WHERE id = ANY($1::bigint[]) AND company_id = $2 AND is_active = TRUE
       ORDER BY id
       FOR UPDATE`,
      [productIds, request.user.companyId],
    )
    if (lockedProducts.rowCount !== productIds.length) {
      throw new ApiError(404, 'Uno o más productos no existen o están archivados.')
    }

    const productById = new Map(
      lockedProducts.rows.map((product) => [String(product.id), product]),
    )
    for (const item of saleRequest.items) {
      const product = productById.get(String(item.productId))
      if (item.quantity > Number(product.stock)) {
        throw new ApiError(
          409,
          `Stock insuficiente para ${product.name} (${product.reference}). Disponible: ${product.stock}.`,
        )
      }
    }

    for (const item of saleRequest.items) {
      const saleItem = await client.query(
        `INSERT INTO sale_items (company_id, sale_id, product_id, quantity, unit_price)
         SELECT $1, $2, p.id, $4, p.price
         FROM products p
         WHERE p.id = $3 AND p.company_id = $1 AND p.is_active = TRUE
         RETURNING id`,
        [request.user.companyId, saleId, item.productId, item.quantity],
      )
      if (!saleItem.rowCount) {
        throw new ApiError(409, 'El producto dejó de estar disponible.')
      }

      await client.query(
        `INSERT INTO stock_movements
           (company_id, product_id, movement_type, quantity_delta, sale_item_id, created_by)
         VALUES ($1, $2, 'sale', $3, $4, $5)`,
        [
          request.user.companyId,
          item.productId,
          -item.quantity,
          saleItem.rows[0].id,
          request.user.id,
        ],
      )
    }

    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'sale.confirmed', $3, $4::jsonb)`,
      [
        request.user.companyId,
        request.user.id,
        saleId,
        JSON.stringify({
          itemCount: saleRequest.items.length,
          idempotencyKey: saleRequest.idempotencyKey,
        }),
      ],
    )

    return {
      sale: await loadSale(client, saleId, request.user.companyId),
      replayed: false,
    }
  })

  response.status(result.replayed ? 200 : 201).json({ item: result.sale })
})

export default router
