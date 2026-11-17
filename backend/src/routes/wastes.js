import { Router } from 'express'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const wasteSchema = z.object({
  wasteType: z.enum(['damage', 'expiry', 'other']),
  reason: z.string().trim().min(1).max(500),
  responsibleUserId: z.number().int().positive(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().finite().positive().max(99999999999.999)
      .refine((quantity) => Number.isInteger(quantity * 1000)),
  })).min(1).max(100).superRefine((items, context) => {
    const seen = new Set()
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'productId'],
          message: 'Un producto solo puede aparecer una vez por registro.',
        })
      }
      seen.add(item.productId)
    })
  }),
})

router.get(
  '/responsibles',
  requireRoles('admin', 'warehouse'),
  async (request, response) => {
    const result = await pool.query(
      `SELECT id, full_name AS "fullName"
       FROM users
       WHERE company_id = $1 AND is_active = TRUE
       ORDER BY full_name ASC, id ASC`,
      [request.user.companyId],
    )
    response.json({ items: result.rows })
  },
)

router.get('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '20', 10)
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }

  const [count, records] = await Promise.all([
    pool.query(
      'SELECT count(*)::int AS total FROM waste_records WHERE company_id = $1',
      [request.user.companyId],
    ),
    pool.query(
      `SELECT wr.id, wr.waste_type AS "wasteType", wr.reason,
              wr.created_at AS "createdAt",
              responsible.full_name AS "responsibleName",
              creator.full_name AS "createdBy",
              count(wri.id)::int AS "itemCount",
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'productId', p.id,
                    'reference', p.reference,
                    'name', p.name,
                    'quantity', wri.quantity
                  )
                  ORDER BY wri.id
                ) FILTER (WHERE wri.id IS NOT NULL),
                '[]'::jsonb
              ) AS items
       FROM waste_records wr
       JOIN users responsible
         ON responsible.id = wr.responsible_user_id
        AND responsible.company_id = wr.company_id
       JOIN users creator ON creator.id = wr.created_by AND creator.company_id = wr.company_id
       LEFT JOIN waste_record_items wri
         ON wri.waste_record_id = wr.id AND wri.company_id = wr.company_id
       LEFT JOIN products p ON p.id = wri.product_id AND p.company_id = wr.company_id
       WHERE wr.company_id = $1
       GROUP BY wr.id, responsible.id, creator.id
       ORDER BY wr.created_at DESC, wr.id DESC
       LIMIT $2 OFFSET $3`,
      [request.user.companyId, pageSize, (page - 1) * pageSize],
    ),
  ])

  response.json({
    items: records.rows.map((record) => ({
      ...record,
      items: record.items.map((item) => ({
        ...item,
        productId: Number(item.productId),
        quantity: Number(item.quantity),
      })),
    })),
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

router.post('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const parsed = wasteSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Revisa el tipo, motivo, responsable y productos de la merma.')
  }

  const wasteRequest = parsed.data
  const created = await withTransaction(async (client) => {
    const responsible = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE FOR KEY SHARE`,
      [wasteRequest.responsibleUserId, request.user.companyId],
    )
    if (!responsible.rowCount) {
      throw new ApiError(404, 'No se encontró un responsable activo.')
    }

    const productIds = wasteRequest.items
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
    for (const item of wasteRequest.items) {
      const product = productById.get(String(item.productId))
      if (item.quantity > Number(product.stock)) {
        throw new ApiError(
          409,
          `Stock insuficiente para ${product.name} (${product.reference}). Disponible: ${product.stock}.`,
        )
      }
    }

    const recordResult = await client.query(
      `INSERT INTO waste_records
         (company_id, waste_type, reason, responsible_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, waste_type AS "wasteType", reason,
                 created_at AS "createdAt"`,
      [
        request.user.companyId,
        wasteRequest.wasteType,
        wasteRequest.reason,
        wasteRequest.responsibleUserId,
        request.user.id,
      ],
    )
    const record = recordResult.rows[0]
    const items = []

    for (const item of wasteRequest.items) {
      const insertedItem = await client.query(
        `INSERT INTO waste_record_items (company_id, waste_record_id, product_id, quantity)
         VALUES ($1, $2, $3, $4)
         RETURNING id, product_id AS "productId", quantity::text AS quantity`,
        [request.user.companyId, record.id, item.productId, item.quantity],
      )
      const savedItem = insertedItem.rows[0]

      await client.query(
        `INSERT INTO stock_movements
           (company_id, product_id, movement_type, quantity_delta,
            waste_record_item_id, created_by)
         VALUES ($1, $2, 'waste', $3, $4, $5)`,
        [request.user.companyId, item.productId, -item.quantity, savedItem.id, request.user.id],
      )
      const product = productById.get(String(item.productId))
      items.push({
        ...savedItem,
        productId: Number(savedItem.productId),
        quantity: Number(savedItem.quantity),
        name: product.name,
        reference: product.reference,
      })
    }

    await client.query(
      `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'waste.recorded', 'waste_record', $3, $4::jsonb)`,
      [
        request.user.companyId,
        request.user.id,
        record.id,
        JSON.stringify({
          wasteType: record.wasteType,
          responsibleUserId: wasteRequest.responsibleUserId,
          itemCount: items.length,
          reason: wasteRequest.reason,
        }),
      ],
    )

    const responsibleResult = await client.query(
      'SELECT full_name AS "responsibleName" FROM users WHERE id = $1 AND company_id = $2',
      [wasteRequest.responsibleUserId, request.user.companyId],
    )
    const creatorResult = await client.query(
      'SELECT full_name AS "createdBy" FROM users WHERE id = $1 AND company_id = $2',
      [request.user.id, request.user.companyId],
    )
    return {
      ...record,
      responsibleName: responsibleResult.rows[0].responsibleName,
      createdBy: creatorResult.rows[0].createdBy,
      itemCount: items.length,
      items,
    }
  })

  response.status(201).json({ item: created })
})

export default router
