import 'dotenv/config'
import pg from 'pg'

const { Pool } = pg

const useConnectionString = Boolean(process.env.DATABASE_URL)

const connectionConfig = useConnectionString
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      port: Number.parseInt(process.env.PGPORT || '5432', 10),
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    }

if (!connectionConfig.connectionString
    && (!connectionConfig.database || !connectionConfig.user || !connectionConfig.password)) {
  throw new Error(
    'Configura PGDATABASE, PGUSER y PGPASSWORD en backend/.env.',
  )
}
if (!connectionConfig.connectionString
    && (!Number.isInteger(connectionConfig.port)
      || connectionConfig.port < 1
      || connectionConfig.port > 65535)) {
  throw new Error('PGPORT debe ser un puerto válido en backend/.env.')
}

export const pool = new Pool({
  ...connectionConfig,
  ssl: useConnectionString ? { rejectUnauthorized: false } : false,
  application_name: 'smartstock-api',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})


pool.on('error', (error) => {
  console.error('Error inesperado en una conexión inactiva de PostgreSQL:', error)
})

export async function withTransaction(callback) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function createAdminUser({ email, fullName, passwordHash }) {
  return withTransaction(async (client) => {
    const user = await client.query(
      `INSERT INTO users (company_id, full_name, email, password_hash)
       SELECT id, $1, $2, $3
       FROM companies WHERE nit = 'LEGACY-SMARTSTOCK'
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [fullName, email, passwordHash],
    )

    if (!user.rowCount) {
      throw new Error('Ya existe un usuario con ese correo; no se modificó.')
    }

    const role = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'admin'
       RETURNING user_id`,
      [user.rows[0].id],
    )

    if (!role.rowCount) {
      throw new Error('No existe el rol admin. Ejecuta primero la migración de base de datos.')
    }

    await client.query(
      `UPDATE companies SET owner_user_id = $1
       WHERE nit = 'LEGACY-SMARTSTOCK' AND owner_user_id IS NULL`,
      [user.rows[0].id],
    )

    return user.rows[0].id
  })
}

export async function createPlatformAdminUser({ email, fullName, passwordHash }) {
  return withTransaction(async (client) => {
    const user = await client.query(
      `INSERT INTO users (company_id, full_name, email, password_hash)
       VALUES (NULL, $1, $2, $3)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [fullName, email, passwordHash],
    )
    if (!user.rowCount) {
      throw new Error('Ya existe un usuario con ese correo; no se modificó.')
    }

    const role = await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'platform_admin'
       RETURNING user_id`,
      [user.rows[0].id],
    )
    if (!role.rowCount) {
      throw new Error('No existe el rol platform_admin. Ejecuta primero la migración de base de datos.')
    }
    return user.rows[0].id
  })
}

export function setAuditActor(client, userId) {
  return client.query(
    "SELECT set_config('app.user_id', $1, TRUE)",
    [String(userId)],
  )
}
