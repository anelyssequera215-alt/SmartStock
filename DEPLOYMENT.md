# Despliegue de SmartStock

La configuración preparada usa Vercel para el frontend, Render para la API y
Supabase para PostgreSQL. No contiene credenciales ni crea servicios en la nube.

## 1. Base de datos en Supabase

1. Crea un proyecto PostgreSQL y guarda en un gestor seguro la contraseña y la
   cadena de conexión del pooler o de la conexión directa.
2. En una base nueva, ejecuta en orden las migraciones
   `database/migrations/001_initial_schema.sql` a
   `database/migrations/007_saas_companies.sql`, una sola vez cada una.
   Si ya aplicaste las migraciones 001 a 006, aplica únicamente
   `007_saas_companies.sql`; no vuelvas a ejecutar migraciones anteriores.
   La migración 007 asigna los datos existentes a la empresa heredada
   "SmartStock (Legacy)" y crea el esquema multiempresa. Revisa y respalda la
   base antes de ejecutarla.
3. En Supabase, verifica que las conexiones requieran TLS y copia la URL que
   incluya SSL (`sslmode=require`) para `DATABASE_URL` en Render.
4. Después de aplicar la migración 007, crea el administrador de plataforma
   desde un entorno local conectado a esta base: configura `DATABASE_URL` con la
   conexión de Supabase y define `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_NAME` y
   `PLATFORM_ADMIN_PASSWORD`; luego ejecuta
   `node scripts/create-platform-admin.js` desde `backend`.
   `DATABASE_URL` tiene prioridad sobre las variables `PG*` locales. Usa una
   contraseña larga y única y no guardes estas variables en Git.

## 2. API en Render

1. Conecta el repositorio a Render y elige el Blueprint basado en
   `render.yaml`; el directorio raíz del servicio es `backend`.
2. Configura los valores secretos solicitados:
   - `DATABASE_URL`: conexión TLS a Supabase.
   - `JWT_SECRET`: valor aleatorio de al menos 32 caracteres; por ejemplo,
     genera uno con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
   - `FRONTEND_ORIGIN`: origen HTTPS exacto del sitio de Vercel, sin rutas ni
     barra final (por ejemplo, `https://smartstock.vercel.app`).
3. Render configura `PORT`. Espera que `/api/health` responda
   `{"status":"ok"}` antes de publicar el frontend.

## 3. Frontend en Vercel

1. Importa el mismo repositorio y define `frontend` como Root Directory.
2. Usa el preset Vite; Vercel detecta el comando de compilación `npm run build` y
   el directorio de salida `dist`. `frontend/vercel.json` configura la ruta de
   respaldo de la aplicación.
3. Define `VITE_API_BASE_URL` como la URL pública de Render seguida de `/api`,
   por ejemplo `https://smartstock-api.onrender.com/api`. Esta variable queda
   incluida en el JavaScript público: contiene una URL, nunca una clave secreta.
4. Despliega y prueba el registro de una empresa, el inicio de sesión del
   administrador de plataforma y la actualización manual del estado de pago.
   Registra dos empresas y verifica que sus productos, proveedores, ventas y
   reportes permanezcan aislados. Prueba también que el POS rechace una venta
   superior al stock disponible.

## Seguridad y operación

- No subas `.env`, contraseñas, tokens ni cadenas de conexión a Git o Vercel.
- Configura la URL pública de producción en `FRONTEND_ORIGIN`; la API solo
  permite el origen configurado.
- El registro actual no verifica la dirección de correo ni ofrece recuperación
  de contraseña por correo. Antes de abrir el registro a público general,
  configura verificación de correo, recuperación segura y monitoreo de abuso.
- El plan único cuesta COP $69.900 mensuales. El alta da acceso inmediato y el
  estado del pago se registra manualmente desde la administración de plataforma;
  no hay pasarela de pago integrada.
- El dashboard de reposición usa un promedio ponderado de ventas recientes; no
  es un modelo de IA entrenado. Revisa la estimación y los plazos reales antes
  de hacer una compra.
- Configura copias de seguridad de Supabase y limita el acceso de producción a
  personal autorizado.
