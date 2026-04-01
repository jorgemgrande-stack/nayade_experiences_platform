# Guía de Instalación Local — Nayade Experiences Platform

Esta guía te permite clonar y levantar el proyecto en VS Code con el mismo comportamiento, datos y configuración que en Manus.

---

## Requisitos previos

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Node.js | 22.x | Usa `nvm` para gestionar versiones |
| pnpm | 9.x | `npm install -g pnpm` |
| MySQL | 8.0+ | O TiDB / PlanetScale compatible |
| Git | cualquiera | — |

---

## 1. Clonar el repositorio

```bash
git clone https://github.com/TU_USUARIO/nayade_experiences_platform.git
cd nayade_experiences_platform
```

---

## 2. Instalar dependencias

```bash
pnpm install
```

---

## 3. Configurar variables de entorno

Copia el contenido de `ENV_EXAMPLE.md` a un archivo `.env` en la raíz del proyecto:

```bash
cp ENV_EXAMPLE.md .env
# Edita .env con tus valores reales
```

Variables **obligatorias** para el arranque básico:

```
DATABASE_URL=mysql://user:password@localhost:3306/nayade_db
JWT_SECRET=cualquier-string-aleatorio-de-32-chars
NODE_ENV=development
```

---

## 4. Crear la base de datos

```sql
CREATE DATABASE nayade_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## 5. Aplicar el schema de la base de datos

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

O alternativamente, aplicar las migraciones directamente:

```bash
# Las migraciones están en drizzle/migrations/
mysql -u user -p nayade_db < drizzle/migrations/0000_initial.sql
```

---

## 6. Importar los datos del catálogo (seed)

```bash
pnpm seed
```

Esto importa desde `data/seed.json`:
- 14 experiencias con variantes y time slots
- 13 packs
- 20 lego packs con 65 líneas de pack
- 8 tipos de habitación con 12 tarifas
- 10 tratamientos SPA
- 4 restaurantes con menús y turnos
- Configuración CMS (home modules, slideshow, páginas estáticas)
- 20 plantillas de email
- Cupones, descuentos, proveedores, plataformas

---

## 7. Arrancar el servidor de desarrollo

```bash
pnpm dev
```

La aplicación estará disponible en: **http://localhost:3000**

---

## 8. Acceso al panel de administración

- URL: `http://localhost:3000/admin`
- El primer usuario que inicie sesión con Manus OAuth se registra automáticamente.
- Para promover a admin, ejecuta en la BD:

```sql
UPDATE users SET role = 'admin' WHERE email = 'tu@email.com';
```

---

## Estructura del proyecto

```
client/src/pages/          ← Páginas del frontend (pública + admin)
server/routers/            ← Procedimientos tRPC por módulo
drizzle/schema.ts          ← Schema completo de la BD
drizzle/migrations/        ← Migraciones SQL generadas
data/seed.json             ← Datos del catálogo exportados desde Manus
scripts/
  export-seed.mjs          ← Exporta datos de BD → data/seed.json
  import-seed.mjs          ← Importa data/seed.json → BD
```

---

## Módulos disponibles

| Módulo | Ruta admin | Descripción |
|---|---|---|
| Experiencias | `/admin/productos/experiencias` | Catálogo de actividades |
| Packs | `/admin/productos/packs` | Packs de actividades |
| Lego Packs | `/admin/productos/lego-packs` | Packs compuestos configurables |
| Hotel | `/admin/hotel` | Habitaciones, tarifas y reservas |
| SPA | `/admin/spa` | Tratamientos y agenda |
| Restaurantes | `/admin/restaurantes` | Menús, turnos y reservas |
| CRM | `/admin/crm` | Leads, presupuestos, clientes |
| Reservas | `/admin/operaciones` | Gestión operativa |
| TPV | `/admin/tpv` | Terminal punto de venta |
| Contabilidad | `/admin/contabilidad` | Facturas, gastos, liquidaciones |
| Fiscal REAV | `/admin/fiscal-reav` | Expedientes REAV |
| CMS | `/admin/cms` | Contenido de la web |

---

## Datos que dependen de servicios externos

| Dato | Servicio | Notas |
|---|---|---|
| Imágenes de productos | AWS S3 / CDN | Las URLs en seed.json apuntan al CDN de Manus. Necesitas subir las imágenes a tu propio S3 y actualizar las URLs. |
| Pagos online | Redsys | Configura `REDSYS_*` con tus credenciales de sandbox/producción. |
| Emails | SMTP | Configura `SMTP_*` con tu servidor de correo. |
| Leads CRM | GoHighLevel | Configura `GHL_API_KEY` y `GHL_LOCATION_ID`. Sin estas vars, los leads se guardan en BD local pero no se sincronizan con GHL. |
| Autenticación | Manus OAuth | Para desarrollo local, puedes usar el modo de usuario/contraseña o configurar tu propia app OAuth. |

---

## Actualizar el seed

Cuando hagas cambios en el catálogo en Manus y quieras sincronizarlos:

```bash
# En el entorno Manus:
pnpm seed:export

# Luego en local:
git pull
pnpm seed
```

---

## Comandos útiles

```bash
pnpm dev              # Servidor de desarrollo
pnpm build            # Build de producción
pnpm test             # Tests unitarios (vitest)
pnpm check            # Verificación TypeScript
pnpm seed             # Importar datos del catálogo
pnpm seed:export      # Exportar datos del catálogo
pnpm drizzle-kit generate  # Generar migraciones SQL
pnpm drizzle-kit migrate   # Aplicar migraciones
```
