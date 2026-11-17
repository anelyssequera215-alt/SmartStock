import { Router } from 'express'
import { requireRoles } from '../auth.js'
import { pool } from '../db.js'
import { ApiError } from '../errors.js'

const router = Router()
const abcClasses = new Set(['A', 'B', 'C'])

const classifiedProductsQuery = `
  WITH sales_by_product AS (
    SELECT si.product_id,
           sum(si.quantity) AS units_sold
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    WHERE s.status = 'confirmed'
      AND s.company_id = $1 AND si.company_id = $1
      AND s.sold_at >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY si.product_id
  ),
  product_metrics AS (
    SELECT p.id, p.reference, p.name,
           COALESCE(c.name, 'Sin categoría') AS category,
           p.stock_quantity AS stock,
           p.price AS unit_price,
           p.stock_quantity * p.price AS inventory_value,
           COALESCE(sbp.units_sold, 0) AS units_sold
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id AND c.company_id = p.company_id
    LEFT JOIN sales_by_product sbp ON sbp.product_id = p.id
    WHERE p.company_id = $1 AND p.is_active = TRUE
  ),
  ranked_products AS (
    SELECT product_metrics.*,
           sum(units_sold) OVER () AS total_units_sold,
           sum(units_sold) OVER (
             ORDER BY units_sold DESC, id ASC
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS cumulative_units_sold
    FROM product_metrics
  ),
  classified_products AS (
    SELECT ranked_products.*,
           CASE
             WHEN total_units_sold = 0 OR units_sold = 0 THEN 'C'
             WHEN cumulative_units_sold - units_sold < total_units_sold * 0.80 THEN 'A'
             WHEN cumulative_units_sold - units_sold < total_units_sold * 0.95 THEN 'B'
             ELSE 'C'
           END AS abc_class
    FROM ranked_products
  )
`

router.get(
  '/inventory',
  requireRoles('admin', 'warehouse'),
  async (request, response) => {
    const page = Number.parseInt(request.query.page ?? '1', 10)
    const pageSize = Number.parseInt(request.query.pageSize ?? '50', 10)
    const abcClass = String(request.query.class ?? '').trim().toUpperCase()

    if (!Number.isInteger(page) || page < 1
        || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ApiError(400, 'La paginación no es válida.')
    }
    if (abcClass && !abcClasses.has(abcClass)) {
      throw new ApiError(400, 'La clase ABC seleccionada no es válida.')
    }

    const classCondition = abcClass ? 'WHERE abc_class = $2' : ''
    const values = abcClass
      ? [request.user.companyId, abcClass]
      : [request.user.companyId]
    const limitPosition = values.length + 1
    const offsetPosition = values.length + 2

    const [summary, products] = await Promise.all([
      pool.query(
        `WITH sales_by_product AS (
           SELECT si.product_id, sum(si.quantity) AS units_sold
           FROM sales s
           JOIN sale_items si ON si.sale_id = s.id
           WHERE s.status = 'confirmed'
             AND s.company_id = $1 AND si.company_id = $1
             AND s.sold_at >= CURRENT_DATE - INTERVAL '12 months'
           GROUP BY si.product_id
         )
         SELECT count(*)::int AS "productCount",
                COALESCE(sum(p.stock_quantity), 0)::text AS "totalStock",
                COALESCE(sum(p.stock_quantity * p.price), 0)::text AS "potentialSaleValue",
                COALESCE(sum(sbp.units_sold), 0)::text AS "unitsSold",
                (CURRENT_DATE - INTERVAL '12 months')::date::text AS "periodStart",
                CURRENT_DATE::text AS "periodEnd"
         FROM products p
         LEFT JOIN sales_by_product sbp ON sbp.product_id = p.id
         WHERE p.company_id = $1 AND p.is_active = TRUE`,
        [request.user.companyId],
      ),
      pool.query(
        `${classifiedProductsQuery}
         SELECT id, reference, name, category,
                stock::text AS stock,
                unit_price::text AS "unitPrice",
                inventory_value::text AS "inventoryValue",
                units_sold::text AS "unitsSold",
                abc_class AS "abcClass",
                CASE
                  WHEN total_units_sold = 0 THEN '0'
                  ELSE round(units_sold / total_units_sold * 100, 2)::text
                END AS "salesShare",
                CASE
                  WHEN total_units_sold = 0 THEN '0'
                  ELSE round(cumulative_units_sold / total_units_sold * 100, 2)::text
                END AS "cumulativeShare",
                count(*) OVER ()::int AS "filteredTotal"
         FROM classified_products
         ${classCondition}
         ORDER BY units_sold DESC, name ASC, id ASC
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        [...values, pageSize, (page - 1) * pageSize],
      ),
    ])

    response.json({
      summary: {
        ...summary.rows[0],
        productCount: Number(summary.rows[0].productCount),
        totalStock: Number(summary.rows[0].totalStock),
        potentialSaleValue: Number(summary.rows[0].potentialSaleValue),
        unitsSold: Number(summary.rows[0].unitsSold),
      },
      items: products.rows.map((product) => ({
        ...product,
        stock: Number(product.stock),
        unitPrice: Number(product.unitPrice),
        inventoryValue: Number(product.inventoryValue),
        unitsSold: Number(product.unitsSold),
        salesShare: Number(product.salesShare),
        cumulativeShare: Number(product.cumulativeShare),
      })),
      total: products.rowCount ? Number(products.rows[0].filteredTotal) : 0,
      page,
      pageSize,
      abcClass: abcClass || null,
    })
  },
)

export default router
