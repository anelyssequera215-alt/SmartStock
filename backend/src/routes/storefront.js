import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { rateLimit } from 'express-rate-limit'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireAuth, requireRoles, signAccessToken } from '../auth.js'
import { pool, withTransaction } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de registro. Inténtalo de nuevo más tarde.' },
})
const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
})
const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().finite().positive().max(99999999999.999)
      .refine((amount) => Number(amount.toFixed(3)) === amount),
  })).min(1).max(100).superRefine((items, context) => {
    const seen = new Set()
    items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'productId'],
          message: 'Un producto solo puede aparecer una vez por pedido.',
        })
      }
      seen.add(item.productId)
    })
  }),
})
const storefrontProductSelect = `
  SELECT p.id::text AS id, p.reference, p.name,
         COALESCE(c.name, 'Sin categoría') AS category,
         p.price::text AS price,
         p.stock_quantity::text AS stock
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`

function serializeOrder(order) {
  return {
    ...order,
    total: Number(order.total),
    items: order.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(item.lineTotal),
    })),
  }
}

async function loadOrders(queryable, ids) {
  if (!ids.length) return []
  const result = await queryable.query(
    `SELECT co.id::text AS id, co.status, co.created_at AS "createdAt",
            u.full_name AS "customerName", u.email AS "customerEmail",
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'productId', coi.product_id::text,
                  'reference', coi.reference,
                  'name', coi.name,
                  'quantity', coi.quantity,
                  'unitPrice', coi.unit_price,
                  'lineTotal', coi.quantity * coi.unit_price
                )
                ORDER BY coi.id
              ) FILTER (WHERE coi.id IS NOT NULL),
              '[]'::jsonb
            ) AS items,
            COALESCE(sum(coi.quantity * coi.unit_price), 0)::text AS total
     FROM customer_orders co
     JOIN users u ON u.id = co.customer_user_id
     LEFT JOIN customer_order_items coi ON coi.customer_order_id = co.id
     WHERE co.id = ANY($1::bigint[])
     GROUP BY co.id, u.id`,
    [ids],
  )
  return result.rows.map(serializeOrder)
}

async function loadOrder(queryable, id) {
  return (await loadOrders(queryable, [id]))[0] ?? null
}

function parseOrderId(id) {
  if (!/^[1-9]\d{0,18}$/.test(id)) {
    throw new ApiError(400, 'El identificador del pedido no es válido.')
  }
  return id
}

router.post('/register', registrationLimiter, async (request, response) => {
  const parsed = registrationSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(
      400,
      'Escribe un nombre, un correo válido y una contraseña de al menos 12 caracteres.',
    )
  }

  const { fullName, email, password } = parsed.data
  const passwordHash = await bcrypt.hash(password, 12)
  const user = await withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO users (full_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, full_name AS "fullName", email, auth_version AS "authVersion"`,
      [fullName, email.toLowerCase(), passwordHash],
    )
    const created = inserted.rows[0]
    const role = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'customer'
       RETURNING user_id`,
      [created.id],
    )
    if (!role.rowCount) {
      throw new ApiError(500, 'El registro de clientes no está configurado.')
    }
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'customer.registered', 'user', $1, $2::jsonb)`,
      [created.id, JSON.stringify({ fullName: created.fullName, email: created.email })],
    )
    return created
  })

  response.status(201).json({
    token: signAccessToken({ ...user, roles: ['customer'] }),
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      roles: ['customer'],
    },
  })
})

router.get('/products', async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '24', 10)
  const search = String(request.query.search ?? '').trim().slice(0, 120)
  const category = String(request.query.category ?? '').trim()
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }

  const values = []
  const conditions = ['p.is_active = TRUE']
  if (search) {
    values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`)
    conditions.push(
      `(p.name ILIKE $${values.length} ESCAPE '\\' OR p.reference ILIKE $${values.length} ESCAPE '\\')`,
    )
  }
  if (category) {
    values.push(category)
    conditions.push(`c.name = $${values.length}`)
  }
  const where = conditions.join(' AND ')
  const [count, categories, products] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS total
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where}`,
      values,
    ),
    pool.query(
      `SELECT DISTINCT c.name
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.is_active = TRUE
       ORDER BY c.name`,
    ),
    pool.query(
      `${storefrontProductSelect}
       WHERE ${where}
       ORDER BY p.name, p.id
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    ),
  ])

  response.json({
    items: products.rows.map(({ stock, ...product }) => ({
      ...product,
      price: Number(product.price),
      inStock: Number(stock) > 0,
    })),
    categories: categories.rows.map((row) => row.name),
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

router.use(requireAuth)

router.get('/orders', requireRoles('customer'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '25', 10)
  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }
  const [count, orders] = await Promise.all([
    pool.query(
      'SELECT count(*)::int AS total FROM customer_orders WHERE customer_user_id = $1',
      [request.user.id],
    ),
    pool.query(
      `SELECT id FROM customer_orders
       WHERE customer_user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [request.user.id, pageSize, (page - 1) * pageSize],
    ),
  ])
  response.json({
    items: await loadOrders(pool, orders.rows.map((order) => order.id)),
    total: count.rows[0].total,
    page,
    pageSize,
  })
})

router.post('/orders', requireRoles('customer'), async (request, response) => {
  const parsed = orderSchema.safeParse(request.body)
  if (!parsed.success) {
    throw new ApiError(400, 'Selecciona productos y cantidades válidos para el pedido.')
  }

  const orderItems = parsed.data.items
  const created = await withTransaction(async (client) => {
    const productIds = orderItems.map((item) => item.productId).sort((a, b) => a - b)
    const products = await client.query(
      `${storefrontProductSelect}
       WHERE p.id = ANY($1::bigint[]) AND p.is_active = TRUE
       ORDER BY p.id
       FOR UPDATE OF p`,
      [productIds],
    )
    if (products.rowCount !== productIds.length) {
      throw new ApiError(404, 'Uno o más productos ya no están disponibles.')
    }

    const productById = new Map(products.rows.map((product) => [product.id, product]))
    for (const item of orderItems) {
      const product = productById.get(String(item.productId))
      if (Number(product.stock) <= 0) {
        throw new ApiError(409, `${product.name} está agotado.`)
      }
      if (item.quantity > Number(product.stock)) {
        throw new ApiError(
          409,
          `No hay suficientes existencias de ${product.name}. Disponible: ${product.stock}.`,
        )
      }
    }

    const inserted = await client.query(
      `INSERT INTO customer_orders (customer_user_id)
       VALUES ($1) RETURNING id`,
      [request.user.id],
    )
    const orderId = inserted.rows[0].id
    for (const item of orderItems) {
      const product = productById.get(String(item.productId))
      await client.query(
        `INSERT INTO customer_order_items
           (customer_order_id, product_id, reference, name, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.productId, product.reference, product.name, item.quantity, product.price],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'customer_order.placed', 'customer_order', $2, $3::jsonb)`,
      [request.user.id, orderId, JSON.stringify({ itemCount: orderItems.length })],
    )
    return loadOrder(client, orderId)
  })

  response.status(201).json({ item: created })
})

router.patch('/orders/:id/cancel', requireRoles('customer'), async (request, response) => {
  const orderId = parseOrderId(request.params.id)
  const order = await withTransaction(async (client) => {
    const current = await client.query(
      `SELECT id, status FROM customer_orders
       WHERE id = $1 AND customer_user_id = $2 FOR UPDATE`,
      [orderId, request.user.id],
    )
    if (!current.rowCount) throw new ApiError(404, 'No se encontró el pedido.')
    if (current.rows[0].status !== 'pending') {
      throw new ApiError(409, 'Solo puedes cancelar pedidos pendientes.')
    }
    await client.query(
      `UPDATE customer_orders SET status = 'cancelled' WHERE id = $1`,
      [orderId],
    )
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'customer_order.cancelled', 'customer_order', $2, '{}'::jsonb)`,
      [request.user.id, orderId],
    )
    return loadOrder(client, orderId)
  })
  response.json({ item: order })
})

router.get(
  '/orders/manage',
  requireRoles('admin', 'cashier'),
  async (request, response) => {
    const page = Number.parseInt(request.query.page ?? '1', 10)
    const pageSize = Number.parseInt(request.query.pageSize ?? '25', 10)
    const status = String(request.query.status ?? '').trim()
    if (!Number.isInteger(page) || page < 1
        || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ApiError(400, 'La paginación no es válida.')
    }
    if (status && !['pending', 'confirmed', 'declined', 'cancelled'].includes(status)) {
      throw new ApiError(400, 'El estado del pedido no es válido.')
    }
    const values = status ? [status] : []
    const [count, orders] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total FROM customer_orders
         ${status ? 'WHERE status = $1' : ''}`,
        values,
      ),
      pool.query(
        `SELECT id FROM customer_orders
         ${status ? 'WHERE status = $1' : ''}
         ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
                  created_at DESC, id DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
    ])
    response.json({
      items: await loadOrders(pool, orders.rows.map((order) => order.id)),
      total: count.rows[0].total,
      page,
      pageSize,
    })
  },
)

router.post(
  '/orders/:id/confirm',
  requireRoles('admin', 'cashier'),
  async (request, response) => {
    const orderId = parseOrderId(request.params.id)
    const order = await withTransaction(async (client) => {
      const pending = await client.query(
        `SELECT id FROM customer_orders
         WHERE id = $1 AND status = 'pending'
         FOR UPDATE`,
        [orderId],
      )
      if (!pending.rowCount) {
        throw new ApiError(409, 'El pedido ya fue procesado o no existe.')
      }
      const items = await client.query(
        `SELECT product_id AS "productId", quantity::text AS quantity
         FROM customer_order_items
         WHERE customer_order_id = $1
         ORDER BY product_id`,
        [orderId],
      )
      const productIds = items.rows.map((item) => Number(item.productId))
      const locked = await client.query(
        `SELECT id, name, reference, stock_quantity::text AS stock
         FROM products
         WHERE id = ANY($1::bigint[]) AND is_active = TRUE
         ORDER BY id
         FOR UPDATE`,
        [productIds],
      )
      if (locked.rowCount !== productIds.length) {
        throw new ApiError(409, 'Uno o más productos del pedido ya no están disponibles.')
      }
      const productById = new Map(locked.rows.map((product) => [String(product.id), product]))
      for (const item of items.rows) {
        const product = productById.get(String(item.productId))
        if (Number(item.quantity) > Number(product.stock)) {
          throw new ApiError(
            409,
            `Stock insuficiente para ${product.name} (${product.reference}). Disponible: ${product.stock}.`,
          )
        }
      }

      const sale = await client.query(
        `INSERT INTO sales (status, sold_at, created_by, idempotency_key, customer_order_id)
         VALUES ('confirmed', now(), $1, $2, $3)
         RETURNING id`,
        [request.user.id, randomUUID(), orderId],
      )
      for (const item of items.rows) {
        const saleItem = await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
           SELECT $1, coi.product_id, coi.quantity, coi.unit_price
           FROM customer_order_items coi
           WHERE coi.customer_order_id = $2 AND coi.product_id = $3
           RETURNING id, product_id, quantity`,
          [sale.rows[0].id, orderId, item.productId],
        )
        await client.query(
          `INSERT INTO stock_movements
             (product_id, movement_type, quantity_delta, sale_item_id, created_by)
           VALUES ($1, 'sale', $2, $3, $4)`,
          [
            saleItem.rows[0].product_id,
            -Number(saleItem.rows[0].quantity),
            saleItem.rows[0].id,
            request.user.id,
          ],
        )
      }
      await client.query(
        `UPDATE customer_orders SET status = 'confirmed' WHERE id = $1`,
        [orderId],
      )
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'sale.confirmed', 'sale', $2, $3::jsonb)`,
        [
          request.user.id,
          sale.rows[0].id,
          JSON.stringify({ customerOrderId: orderId, itemCount: items.rowCount }),
        ],
      )
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'customer_order.confirmed', 'customer_order', $2, '{}'::jsonb)`,
        [request.user.id, orderId],
      )
      return loadOrder(client, orderId)
    })
    response.json({ item: order })
  },
)

router.post(
  '/orders/:id/decline',
  requireRoles('admin', 'cashier'),
  async (request, response) => {
    const orderId = parseOrderId(request.params.id)
    const order = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE customer_orders
         SET status = 'declined'
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [orderId],
      )
      if (!result.rowCount) {
        throw new ApiError(409, 'El pedido ya fue procesado o no existe.')
      }
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'customer_order.declined', 'customer_order', $2, '{}'::jsonb)`,
        [request.user.id, orderId],
      )
      return loadOrder(client, orderId)
    })
    response.json({ item: order })
  },
)

export default router
