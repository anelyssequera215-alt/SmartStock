# Manual Técnico y Arquitectura del Sistema - SmartStock ⚙️

Este documento describe la arquitectura técnica, los componentes de software, las decisiones de diseño y las medidas de seguridad implementadas en el desarrollo de la plataforma **SmartStock**.

## 1. Arquitectura General

SmartStock está construido utilizando una arquitectura Cliente-Servidor bajo el stack **PERN** (PostgreSQL, Express, React, Node.js). 

* **Frontend:** Single Page Application (SPA) desarrollada con React 19 y empaquetada con Vite.
* **Backend:** API RESTful modular construida con Node.js y Express 5.
* **Base de Datos:** PostgreSQL relacional, que actúa no solo como almacenamiento, sino como el motor principal de las reglas de negocio e integridad de los datos.

---

## 2. Base de Datos (PostgreSQL) y Reglas de Negocio

La capa de datos fue diseñada con un enfoque defensivo. Se priorizó la inmutabilidad y la trazabilidad, asegurando que ninguna operación desde el backend pueda corromper el estado del inventario.

### 2.1 Integridad del Inventario (Stock Movements)
El campo `stock_quantity` de la tabla `products` nunca se actualiza de forma manual ni directa a través de un `UPDATE` simple desde el backend. 
* Se implementó el trigger `protect_product_stock` que bloquea cualquier modificación directa al inventario.
* **Flujo obligatorio:** Todo cambio de existencias debe registrarse insertando un registro en la tabla `stock_movements` (compra, venta, merma o ajuste). 
* El trigger `stock_movements_apply` procesa esta inserción, valida las cantidades contra las facturas o ventas, y actualiza automáticamente el `stock_quantity` del producto.

### 2.2 Auditoría e Inmutabilidad (Audit Logs)
* **Inmutabilidad:** Las tablas críticas (`audit_logs`, `stock_movements`, `purchase_invoice_items`) cuentan con triggers (ej. `audit_logs_immutable`) que lanzan una excepción si se intenta realizar un `UPDATE` o `DELETE`.
* **Trazabilidad Contextual:** El backend inyecta el ID del usuario en la sesión de la base de datos mediante la función `set_config('app.user_id', $1, TRUE)`. Esto permite que triggers como `audit_product_price_changes` registren automáticamente en `audit_logs` qué usuario modificó el precio de un producto, sin necesidad de que la aplicación lo envíe explícitamente.

---

## 3. Backend (Node.js & Express)

El servidor actúa como un intermediario seguro entre el cliente y la base de datos, encargado de la validación de entrada, autenticación y enrutamiento.

### 3.1 Seguridad y Autenticación (JWT)
El sistema utiliza JSON Web Tokens (JWT) para la gestión de sesiones sin estado, pero con una capa adicional de validación:
* **Generación y Firma:** Los tokens se firman con un secreto fuerte de 32+ caracteres (`JWT_SECRET`).
* **Revocación Instantánea:** En el payload del token se incluye el campo `ver` (versión). El middleware `requireAuth` en `auth.js` verifica que la versión del token coincida con el campo `auth_version` del usuario en la base de datos. Si el administrador cambia el rol de un usuario o lo desactiva, la versión cambia y todos sus tokens activos se invalidan instantáneamente.
* **Control de Acceso Basado en Roles (RBAC):** Se utiliza el middleware `requireRoles('admin', 'warehouse', 'cashier')` en las rutas para restringir acciones (ej. solo el admin y warehouse pueden crear productos).

### 3.2 Manejo de Transacciones y Validaciones
* **Transacciones ACID:** Operaciones complejas (como crear un producto e inyectar su stock inicial) se envuelven en la función `withTransaction` en `db.js`. Si ocurre un error, se ejecuta un `ROLLBACK` automático.
* **Validación de Datos:** Se utiliza la librería `Zod` (ej. `productSchema`) para validar de forma estricta los cuerpos (bodies) de las peticiones HTTP antes de que toquen la base de datos.

---

## 4. Frontend (React & Vite)

La interfaz de usuario está optimizada para la velocidad y la experiencia de usuario (UX) en operaciones de caja o bodega.

### 4.1 Gestión de Estado y Rendimiento
* **Filtrado en Cliente:** El componente principal (`App.jsx`) almacena el catálogo de productos. Se utiliza el hook `useMemo` para procesar la barra de búsqueda y los filtros de categoría/estado en tiempo real, evitando solicitudes innecesarias al backend.
* **Debouncing:** La petición a la API al escribir en la barra de búsqueda tiene un retraso intencional (`setTimeout` de 250ms) combinado con `AbortController` para cancelar peticiones obsoletas y no saturar el servidor.

### 4.2 Centralización de API (`api.js`)
Toda comunicación con el backend pasa por la función `apiRequest`. Esta utilidad se encarga de:
* Adjuntar automáticamente el token JWT en las cabeceras (`Authorization: Bearer`).
* Interceptar códigos de error HTTP (como `401 Unauthorized`) para limpiar la sesión en el navegador (`sessionStorage`) y redirigir al login.

---

## 5. Configuración y Despliegue (Variables de Entorno)

La separación de entornos se gestiona mediante archivos `.env`.

* **Backend:** Requiere configuración de conexión (host, puerto, credenciales) de PostgreSQL (`PGHOST`, `PGUSER`, `PGPASSWORD`) y el secreto de JWT.
* **Frontend:** Utiliza Vite, configurado mediante `VITE_API_BASE_URL=/api`. En desarrollo, Vite actúa como proxy inverso hacia el backend para evitar problemas de CORS, y en producción permite servir el frontend estático y la API bajo un mismo dominio.