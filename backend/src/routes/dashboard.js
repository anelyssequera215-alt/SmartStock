import { Router } from 'express'
import { requireRoles } from '../auth.js'
import { pool } from '../db.js'

const router = Router()

router.get('/', requireRoles('admin', 'warehouse', 'cashier'), async (request, response) => {
  const [summary, salesByDay, recentMovements, topProducts] = await Promise.all([
    pool.query(
      `SELECT count(*)::int AS "productCount",
              count(*) FILTER (
                WHERE stock_quantity <= minimum_stock
              )::int AS "lowStockCount",
              count(*) FILTER (WHERE stock_quantity = 0)::int AS "outOfStockCount",
              COALESCE(sum(stock_quantity), 0)::text AS "unitsOnHand",
              COALESCE(sum(stock_quantity * price), 0)::text AS "inventoryValue"
       FROM products
       WHERE company_id = $1 AND is_active = TRUE`,
      [request.user.companyId],
    ),
    pool.query(
      `WITH days AS (
         SELECT generate_series(
           (now() AT TIME ZONE 'America/Bogota')::date - 6,
           (now() AT TIME ZONE 'America/Bogota')::date,
           INTERVAL '1 day'
         )::date AS day
       )
       SELECT days.day::text AS date,
              COALESCE(sum(si.quantity * si.unit_price), 0)::text AS total,
              count(DISTINCT s.id)::int AS "saleCount"
       FROM days
       LEFT JOIN sales s
         ON s.status = 'confirmed'
        AND s.company_id = $1
        AND s.sold_at >= (days.day::timestamp AT TIME ZONE 'America/Bogota')
        AND s.sold_at < ((days.day + 1)::timestamp AT TIME ZONE 'America/Bogota')
       LEFT JOIN sale_items si
         ON si.sale_id = s.id AND si.company_id = s.company_id
       GROUP BY days.day
       ORDER BY days.day`,
      [request.user.companyId],
    ),
    pool.query(
      `SELECT sm.id::text AS id, sm.movement_type AS type,
              p.name AS "productName", p.reference,
              sm.quantity_delta::text AS "quantityDelta",
              sm.created_at AS "createdAt", u.full_name AS "actorName"
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id AND p.company_id = sm.company_id
       JOIN users u ON u.id = sm.created_by AND u.company_id = sm.company_id
       WHERE sm.company_id = $1
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT 6`,
      [request.user.companyId],
    ),
    pool.query(
      `SELECT p.name, p.reference,
              sum(si.quantity)::text AS "unitsSold",
              sum(si.quantity * si.unit_price)::text AS revenue
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id AND si.company_id = s.company_id
       JOIN products p ON p.id = si.product_id AND p.company_id = s.company_id
       WHERE s.status = 'confirmed'
         AND s.company_id = $1
         AND si.company_id = $1
         AND s.sold_at >= now() - INTERVAL '30 days'
       GROUP BY p.id
       ORDER BY sum(si.quantity) DESC, p.name ASC
       LIMIT 5`,
      [request.user.companyId],
    ),
  ])

  response.json({
    summary: {
      ...summary.rows[0],
      unitsOnHand: Number(summary.rows[0].unitsOnHand),
      inventoryValue: Number(summary.rows[0].inventoryValue),
    },
    salesByDay: salesByDay.rows.map((day) => ({
      ...day,
      total: Number(day.total),
    })),
    recentMovements: recentMovements.rows.map((movement) => ({
      ...movement,
      quantityDelta: Number(movement.quantityDelta),
    })),
    topProducts: topProducts.rows.map((product) => ({
      ...product,
      unitsSold: Number(product.unitsSold),
      revenue: Number(product.revenue),
    })),
  })
})

export default router
