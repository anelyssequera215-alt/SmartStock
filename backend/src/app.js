import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { requireAuth } from './auth.js'
import { errorHandler } from './errors.js'
import auditRouter from './routes/audit.js'
import authRouter from './routes/auth.js'
import dashboardRouter from './routes/dashboard.js'
import movementsRouter from './routes/movements.js'
import productsRouter from './routes/products.js'
import purchasesRouter from './routes/purchases.js'
import replenishmentRouter from './routes/replenishment.js'
import reportsRouter from './routes/reports.js'
import salesRouter from './routes/sales.js'
import suppliersRouter from './routes/suppliers.js'
import usersRouter from './routes/users.js'
import wastesRouter from './routes/wastes.js'
import platformRouter from './routes/platform.js'

export const app = express()

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
}))
app.use(express.json({ limit: '32kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.use('/api/auth', authRouter)
app.use('/api/platform', requireAuth, platformRouter)
app.use('/api/dashboard', requireAuth, dashboardRouter)
app.use('/api/audit', requireAuth, auditRouter)
app.use('/api/products', requireAuth, productsRouter)
app.use('/api/movements', requireAuth, movementsRouter)
app.use('/api/replenishment', requireAuth, replenishmentRouter)
app.use('/api/reports', requireAuth, reportsRouter)
app.use('/api/suppliers', requireAuth, suppliersRouter)
app.use('/api/purchases', requireAuth, purchasesRouter)
app.use('/api/sales', requireAuth, salesRouter)
app.use('/api/users', requireAuth, usersRouter)
app.use('/api/wastes', requireAuth, wastesRouter)

app.use((_request, _response, next) => {
  next(Object.assign(new Error('No se encontró esta ruta.'), { status: 404 }))
})

app.use(errorHandler)
