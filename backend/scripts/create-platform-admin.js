import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { createPlatformAdminUser, pool } from '../src/db.js'

const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.PLATFORM_ADMIN_PASSWORD
const fullName = process.env.PLATFORM_ADMIN_NAME?.trim()

if (!email || !password || !fullName) {
  throw new Error(
    'Configura PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD y PLATFORM_ADMIN_NAME antes de crear el administrador de plataforma.',
  )
}
if (password.length < 12 || password.length > 128) {
  throw new Error('PLATFORM_ADMIN_PASSWORD debe tener entre 12 y 128 caracteres.')
}

try {
  const hash = await bcrypt.hash(password, 12)
  await createPlatformAdminUser({ email, fullName, passwordHash: hash })
  console.log(`Administrador de plataforma creado: ${email}`)
} catch (error) {
  console.error('No fue posible crear el administrador de plataforma:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
