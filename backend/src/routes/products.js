import { Router } from 'express'
import { z } from 'zod'
import { requireRoles } from '../auth.js'
import { pool, setAuditActor, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const productSchema = z.object({
  reference: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  price: z.number().finite().min(0).max(999999999999),
  stock: z.number().finite().min(0).max(99999999999.999),
  minimumStock: z.number().finite().min(0).max(99999999999.999),
})

const productSelect = `
  SELECT p.id, p.reference, p.name, c.name AS category,
         p.price::text AS price, p.stock_quantity::text AS stock,
         p.minimum_stock::text AS "minimumStock",
         p.updated_at AS "updatedAt"
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
`

function serializeProduct(row) {
  return {
    ...row,
    price: Number(row.price),
    stock: Number(row.stock),
    minimumStock: Number(row.minimumStock),
    updatedAt: row.updatedAt?.toISOString(),
  }
}

async function getProductById(queryable, id, companyId) {
  const result = await queryable.query(
    `${productSelect} WHERE p.id = $1 AND p.company_id = $2 AND p.is_active = TRUE`,
    [id, companyId],
  )
  return result.rows[0] ? serializeProduct(result.rows[0]) : null
}

router.get('/', requireRoles('admin', 'warehouse', 'cashier'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '100', 10)
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }

  const search = String(request.query.search ?? '').trim().slice(0, 120)
  const category = String(request.query.category ?? '').trim()
  const stock = String(request.query.stock ?? '').trim()
  const values = [request.user.companyId]
  const conditions = ['p.company_id = $1', 'p.is_active = TRUE']

  if (search) {
    values.push(`%${search}%`)
    conditions.push(`(p.name ILIKE $${values.length} OR p.reference ILIKE $${values.length})`)
  }
  if (category && category !== 'Todas') {
    values.push(category)
    conditions.push(`c.name = $${values.length}`)
  }
  if (stock === 'low') conditions.push('p.stock_quantity <= p.minimum_stock')
  if (stock === 'available') conditions.push('p.stock_quantity > p.minimum_stock')
  if (stock && !['low', 'available'].includes(stock)) {
    throw new ApiError(400, 'El filtro de existencias no es válido.')
  }

  const where = conditions.join(' AND ')
  const count = await pool.query(
    `SELECT count(*)::int AS total
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
     WHERE ${where}`,
    values,
  )
  const summary = await pool.query(
    `SELECT count(*)::int AS "totalProducts",
            count(*) FILTER (WHERE stock_quantity <= minimum_stock)::int AS "lowStockCount",
            COALESCE(sum(stock_quantity), 0)::text AS "totalUnits",
            COALESCE(sum(stock_quantity * price), 0)::text AS "inventoryValue"
     FROM products WHERE company_id = $1 AND is_active = TRUE`,
        [request.user.companyId],
  )
  const pageValues = [...values, pageSize, (page - 1) * pageSize]
  const result = await pool.query(
    `${productSelect}
     WHERE ${where}
     ORDER BY p.name ASC, p.id ASC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  )

  response.json({
    items: result.rows.map(serializeProduct),
    total: count.rows[0].total,
    page,
    pageSize,
    summary: {
      totalProducts: summary.rows[0].totalProducts,
      lowStockCount: summary.rows[0].lowStockCount,
      totalUnits: Number(summary.rows[0].totalUnits),
      inventoryValue: Number(summary.rows[0].inventoryValue),
    },
  })
})

router.post(
  '/',
  requireRoles('admin', 'warehouse'),
  async (request, response) => {
    const parsed = productSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new ApiError(400, 'Revisa los campos del producto e intenta de nuevo.')
    }

    const product = parsed.data
    const created = await withTransaction(async (client) => {
      await setAuditActor(client, request.user.id)
      const categoryResult = await client.query(
        `INSERT INTO categories (company_id, name) VALUES ($1, $2)
         ON CONFLICT (company_id, (lower(name)))
         DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [request.user.companyId, product.category],
      )
      const inserted = await client.query(
        `INSERT INTO products
           (company_id, reference, name, category_id, price, minimum_stock)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          request.user.companyId,
          product.reference,
          product.name,
          categoryResult.rows[0].id,
          product.price,
          product.minimumStock,
        ],
      )
      const productId = inserted.rows[0].id

      if (product.stock > 0) {
        await client.query(
          `INSERT INTO stock_movements
             (company_id, product_id, movement_type, quantity_delta, created_by)
           VALUES ($1, $2, 'adjustment', $3, $4)`,
          [request.user.companyId, productId, product.stock, request.user.id],
        )
      }

      await client.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'product.created', 'product', $3, $4::jsonb)`,
        [
          request.user.companyId,
          request.user.id,
          productId,
          JSON.stringify({ reference: product.reference, name: product.name }),
        ],
      )
      return getProductById(client, productId, request.user.companyId)
    })

    response.status(201).json({ item: created })
  },
)

router.patch(
  '/:id',
  requireRoles('admin', 'warehouse'),
  async (request, response) => {
    const id = Number.parseInt(request.params.id, 10)
    const parsed = productSchema.safeParse(request.body)
    if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
      throw new ApiError(400, 'El identificador o los datos del producto no son válidos.')
    }

    const product = parsed.data
    const updated = await withTransaction(async (client) => {
      await setAuditActor(client, request.user.id)
      const categoryResult = await client.query(
        `INSERT INTO categories (company_id, name) VALUES ($1, $2)
         ON CONFLICT (company_id, (lower(name)))
         DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [request.user.companyId, product.category],
      )
      const current = await client.query(
        `SELECT stock_quantity FROM products
         WHERE id = $1 AND company_id = $2 AND is_active = TRUE FOR UPDATE`,
        [id, request.user.companyId],
      )
      if (!current.rowCount) throw new ApiError(404, 'No se encontró el producto.')

      await client.query(
        `UPDATE products
         SET reference = $2, name = $3, category_id = $4,
             price = $5, minimum_stock = $6
         WHERE id = $7 AND company_id = $8`,
        [
          request.user.companyId,
          product.reference,
          product.name,
          categoryResult.rows[0].id,
          product.price,
          product.minimumStock,
          id,
          request.user.companyId,
        ],
      )

      const stockDelta = product.stock - Number(current.rows[0].stock_quantity)
      if (stockDelta !== 0) {
        await client.query(
          `INSERT INTO stock_movements
             (company_id, product_id, movement_type, quantity_delta, created_by)
           VALUES ($1, $2, 'adjustment', $3, $4)`,
          [request.user.companyId, id, stockDelta, request.user.id],
        )
      }

      await client.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'product.updated', 'product', $3, $4::jsonb)`,
        [
          request.user.companyId,
          request.user.id,
          id,
          JSON.stringify({ reference: product.reference, name: product.name }),
        ],
      )
      return getProductById(client, id, request.user.companyId)
    })

    response.json({ item: updated })
  },
)

router.delete(
  '/:id',
  requireRoles('admin', 'warehouse'),
  async (request, response) => {
    const id = Number.parseInt(request.params.id, 10)
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new ApiError(400, 'El identificador del producto no es válido.')
    }

    await withTransaction(async (client) => {
      const product = await client.query(
        `UPDATE products
         SET is_active = FALSE
         WHERE id = $1 AND company_id = $2 AND is_active = TRUE
         RETURNING reference, name`,
        [id, request.user.companyId],
      )
      if (!product.rowCount) throw new ApiError(404, 'No se encontró el producto.')

      await client.query(
        `INSERT INTO audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'product.archived', 'product', $3, $4::jsonb)`,
        [
          request.user.companyId,
          request.user.id,
          id,
          JSON.stringify(product.rows[0]),
        ],
      )
    })

    response.status(204).end()
  },
)

export default router
