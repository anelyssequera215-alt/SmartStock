import { Router } from 'express'
import { requireRoles } from '../auth.js'
import { pool } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const planningWindowDays = 90
const recentWindowDays = 30
const baselineWindowDays = planningWindowDays - recentWindowDays
const recentDemandWeight = 0.65
const baselineDemandWeight = 0.35
const leadTimeDays = 7
const safetyStockDays = 7

router.get('/', requireRoles('admin', 'warehouse'), async (request, response) => {
  const page = Number.parseInt(request.query.page ?? '1', 10)
  const pageSize = Number.parseInt(request.query.pageSize ?? '50', 10)
  const search = String(request.query.search ?? '').trim().slice(0, 120)

  if (!Number.isInteger(page) || page < 1
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'La paginación no es válida.')
  }

  const values = [request.user.companyId]
  let searchCondition = ''
  if (search) {
    values.push(`%${search}%`)
    searchCondition = `AND (name ILIKE $2 OR reference ILIKE $2 OR category ILIKE $2)`
  }
  const filterParams = values
  const limitPosition = values.length + 1
  const offsetPosition = values.length + 2

  const result = await pool.query(
    `WITH sales_by_product AS (
       SELECT si.product_id, sum(si.quantity) AS units_sold,
              sum(si.quantity) FILTER (
                WHERE s.sold_at >= now() - INTERVAL '${recentWindowDays} days'
              ) AS recent_units_sold,
              sum(si.quantity) FILTER (
                WHERE s.sold_at < now() - INTERVAL '${recentWindowDays} days'
              ) AS baseline_units_sold
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       WHERE s.status = 'confirmed'
         AND s.company_id = $1 AND si.company_id = $1
         AND s.sold_at >= now() - INTERVAL '${planningWindowDays} days'
         AND s.sold_at <= now()
       GROUP BY si.product_id
     ),
     demand AS (
       SELECT p.id, p.reference, p.name,
              COALESCE(c.name, 'Sin categoría') AS category,
              p.stock_quantity AS stock,
              p.minimum_stock AS minimum_stock,
              COALESCE(sbp.units_sold, 0) AS units_sold,
              COALESCE(sbp.recent_units_sold, 0) AS recent_units_sold,
              COALESCE(sbp.baseline_units_sold, 0) AS baseline_units_sold,
              COALESCE(sbp.recent_units_sold, 0) / ${recentWindowDays}.0
                * ${recentDemandWeight}
              + COALESCE(sbp.baseline_units_sold, 0) / ${baselineWindowDays}.0
                * ${baselineDemandWeight} AS average_daily_demand
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
       LEFT JOIN sales_by_product sbp ON sbp.product_id = p.id
       WHERE p.company_id = $1 AND p.is_active = TRUE
     ),
     recommendations AS (
       SELECT demand.*,
              GREATEST(
                minimum_stock,
                ceil(average_daily_demand * ${leadTimeDays + safetyStockDays} * 1000) / 1000
              ) AS target_stock,
              GREATEST(
                0,
                GREATEST(
                  minimum_stock,
                  ceil(average_daily_demand * ${leadTimeDays + safetyStockDays} * 1000) / 1000
                ) - stock
              ) AS recommended_quantity
       FROM demand
     ),
     items_to_replenish AS (
       SELECT *
       FROM recommendations
       WHERE recommended_quantity > 0
     ),
     filtered_items AS (
       SELECT *
       FROM items_to_replenish
       WHERE TRUE ${searchCondition}
     )
     SELECT id::text AS id, reference, name, category,
            stock::text AS stock,
            minimum_stock::text AS "minimumStock",
            units_sold::text AS "unitsSold",
            recent_units_sold::text AS "recentUnitsSold",
            baseline_units_sold::text AS "baselineUnitsSold",
            average_daily_demand::text AS "averageDailyDemand",
            target_stock::text AS "targetStock",
            recommended_quantity::text AS "recommendedQuantity",
            count(*) OVER ()::int AS "filteredTotal"
     FROM filtered_items
     ORDER BY
       CASE WHEN stock = 0 THEN 0 ELSE 1 END,
       stock / NULLIF(average_daily_demand, 0) ASC NULLS LAST,
       recommended_quantity DESC,
       name ASC, id ASC
     LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
    [...filterParams, pageSize, (page - 1) * pageSize],
  )

  const countResult = await pool.query(
    `WITH sales_by_product AS (
       SELECT si.product_id, sum(si.quantity) AS units_sold,
              sum(si.quantity) FILTER (
                WHERE s.sold_at >= now() - INTERVAL '${recentWindowDays} days'
              ) AS recent_units_sold,
              sum(si.quantity) FILTER (
                WHERE s.sold_at < now() - INTERVAL '${recentWindowDays} days'
              ) AS baseline_units_sold
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       WHERE s.status = 'confirmed'
         AND s.company_id = $1 AND si.company_id = $1
         AND s.sold_at >= now() - INTERVAL '${planningWindowDays} days'
         AND s.sold_at <= now()
       GROUP BY si.product_id
     ),
     demand AS (
       SELECT p.stock_quantity AS stock,
              GREATEST(
                p.minimum_stock,
                ceil((
                  COALESCE(sbp.recent_units_sold, 0) / ${recentWindowDays}.0
                    * ${recentDemandWeight}
                  + COALESCE(sbp.baseline_units_sold, 0) / ${baselineWindowDays}.0
                    * ${baselineDemandWeight}
                ) * ${leadTimeDays + safetyStockDays} * 1000) / 1000
              ) AS target_stock
       FROM products p
       LEFT JOIN sales_by_product sbp ON sbp.product_id = p.id
       WHERE p.company_id = $1 AND p.is_active = TRUE
     )
     SELECT count(*)::int AS "productCount",
            count(*) FILTER (WHERE stock = 0)::int AS "outOfStockCount",
            COALESCE(sum(target_stock - stock), 0)::text AS "totalRecommendedQuantity"
     FROM demand
     WHERE target_stock > stock`,
     [request.user.companyId],
  )

  response.json({
    items: result.rows.map((item) => ({
      ...item,
      stock: Number(item.stock),
      minimumStock: Number(item.minimumStock),
      unitsSold: Number(item.unitsSold),
      recentUnitsSold: Number(item.recentUnitsSold),
      baselineUnitsSold: Number(item.baselineUnitsSold),
      averageDailyDemand: Number(item.averageDailyDemand),
      targetStock: Number(item.targetStock),
      recommendedQuantity: Number(item.recommendedQuantity),
    })),
    total: result.rowCount ? Number(result.rows[0].filteredTotal) : 0,
    page,
    pageSize,
    summary: {
      productCount: countResult.rows[0].productCount,
      outOfStockCount: countResult.rows[0].outOfStockCount,
      totalRecommendedQuantity: Number(countResult.rows[0].totalRecommendedQuantity),
    },
    policy: {
      planningWindowDays,
      recentWindowDays,
      baselineWindowDays,
      recentDemandWeight,
      baselineDemandWeight,
      leadTimeDays,
      safetyStockDays,
      targetCoverageDays: leadTimeDays + safetyStockDays,
    },
  })
})

export default router
