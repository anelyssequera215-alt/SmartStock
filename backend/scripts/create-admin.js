import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { createAdminUser, pool } from '../src/db.js'

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.ADMIN_PASSWORD
const fullName = process.env.ADMIN_NAME?.trim()

if (!email || !password || !fullName) {
  throw new Error('Configura ADMIN_EMAIL, ADMIN_PASSWORD y ADMIN_NAME antes de crear el administrador.')
}
if (password.length < 12 || password.length > 128) {
  throw new Error('ADMIN_PASSWORD debe tener entre 12 y 128 caracteres.')
}

try {
  const hash = await bcrypt.hash(password, 12)
  await createAdminUser({ email, fullName, passwordHash: hash })
  console.log(`Administrador creado: ${email}`)
} catch (error) {
  console.error('No fue posible crear el administrador:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
