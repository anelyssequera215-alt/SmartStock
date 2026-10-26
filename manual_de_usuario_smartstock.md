# Manual de Usuario - SmartStock ✳

Bienvenido a **SmartStock**, tu plataforma centralizada para la gestión de inventario, ventas y reabastecimiento. Este manual te guiará por las funciones principales del sistema para que puedas mantener tu negocio siempre en orden.

---

## 1. Primeros Pasos: Acceso al Sistema

Para ingresar a SmartStock, debes iniciar sesión con tu correo electrónico y contraseña. El sistema reconocerá automáticamente tu rol asignado:
*   **Administrador:** Acceso total a todas las funciones, incluyendo gestión de usuarios y auditoría.
*   **Bodega (Warehouse):** Gestión de inventario, compras, mermas y reabastecimiento.
*   **Cajero (Cashier):** Registro de ventas presenciales y gestión de pedidos en línea.
*   **Cliente:** Acceso exclusivo al portal de compras (tienda virtual).

---

## 2. Visión General (Dashboard) ▦

Al iniciar sesión (con un rol de personal), la primera pantalla que verás es el **Resumen**. Este panel te ofrece una radiografía en tiempo real de tu negocio:

*   **Indicadores Clave:** En la parte superior verás tarjetas con información vital:
    *   **Productos activos:** Total de referencias en tu catálogo.
    *   **Alertas de Stock:** Cuántos productos están con existencias bajas o agotados.
    *   **Ventas de hoy:** Total facturado en el día y un resumen de los últimos 7 días.
    *   **Valor del inventario:** Un cálculo estimado del dinero que tienes en mercancía a precio de venta.
*   **Gráfica de Ventas:** Visualiza el rendimiento de tus ventas diarias confirmadas durante la última semana.
*   **Actividad Reciente:** Un historial en vivo de los últimos movimientos de inventario (Entradas, Ventas, Mermas o Ajustes).
*   **Accesos Rápidos:** Botones directos para ir al inventario, registrar una venta o revisar el reabastecimiento.

> **💡 Nota:** Si tienes pedidos en línea pendientes por entregar, verás una alerta destacada en amarillo pidiéndote confirmar existencias.

---

## 3. Gestión de Inventario ▤

El módulo de **Inventario** es el corazón de SmartStock. Aquí puedes ver, buscar y gestionar toda tu mercancía.

### Buscar y Filtrar Productos
Para encontrar un producto rápidamente en una lista grande:
1.  **Búsqueda rápida:** Haz clic en la barra de búsqueda o presiona `Ctrl + K` en tu teclado. Puedes buscar por nombre (Ej. *Café molido*) o por referencia (Ej. *CAF-001*).
2.  **Filtros:** Usa los menús desplegables para filtrar por **Categoría** (Alimentos, Aseo, Bebidas, Otros) o por **Estado** (Todos, Disponible, Stock bajo).

### Estados de Stock
El sistema clasifica automáticamente tus productos con etiquetas de colores:
*   🟢 **Disponible:** Las existencias están por encima del stock mínimo requerido.
*   🟡 **Stock bajo:** Las existencias tocaron o bajaron del límite mínimo. ¡Es hora de pedir más!
*   🔴 **Agotado:** El producto tiene 0 existencias.

### Crear un Nuevo Producto
1. Haz clic en el botón azul **"＋ Nuevo producto"** (ubicado en la esquina superior derecha).
2. Llena el formulario con los datos requeridos:
   *   Nombre del producto y Referencia (debe ser única).
   *   Categoría y Precio de venta (en pesos colombianos - COP).
   *   Existencias actuales y el **Stock mínimo para alertas**.
3. Haz clic en **"Guardar producto"**.

### Editar o Archivar Productos
Al final de la fila de cada producto verás un botón con tres puntos (`···`).
*   **Editar:** Permite cambiar el nombre, precio, stock mínimo o corregir existencias.
*   **Eliminar (Archivar):** Por motivos de seguridad y auditoría contable, los productos no se borran definitivamente. Al "eliminarlo", el producto pasa a un estado inactivo para conservar el historial de inventario y no afectar facturas pasadas.

### Exportar Datos
Si necesitas hacer un reporte externo o compartir tu catálogo con un contador, haz clic en el botón **"Exportar"**. Esto descargará automáticamente un archivo `.csv` compatible con Excel que contiene todo tu inventario filtrado.

---

## 4. Otros Módulos Principales

Dependiendo de tu rol, el menú lateral te dará acceso a operaciones específicas:

*   **Ventas ◫:** Registra las salidas de mercancía hacia los clientes. El inventario se descontará automáticamente.
*   **Pedidos en línea ⌂:** Revisa y aprueba las compras hechas por clientes desde el portal.
*   **Compras ↗:** Registra las facturas de tus proveedores. Esto sumará existencias a tu inventario.
*   **Mermas ↘:** Registra productos dañados o vencidos para sacarlos del inventario de forma transparente.
*   **Movimientos ⇄:** Un historial completo de cada entrada y salida de mercancía. Ningún movimiento se puede alterar, garantizando total transparencia.
*   **Auditoría ◷:** (Solo Administradores) Un registro de seguridad que detalla quién creó, editó o archivó productos, e incluso quién modificó los precios.