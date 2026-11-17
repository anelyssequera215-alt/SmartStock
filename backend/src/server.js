import 'dotenv/config'
import { app } from './app.js'
import { pool } from './db.js'

const port = Number.parseInt(process.env.PORT || '3000', 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT debe ser un puerto válido.')
}

await pool.query('SELECT 1')

const server = app.listen(port, () => {
  console.log(`SmartStock API disponible en http://localhost:${port}`)
})

async function shutdown(signal) {
  console.log(`Recibida señal ${signal}; cerrando la API.`)
  server.close(async (error) => {
    await pool.end()
    if (error) {
      console.error('Error cerrando el servidor:', error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
