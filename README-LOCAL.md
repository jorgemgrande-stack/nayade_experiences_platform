# Nayade Experiences Platform — Guía de Arranque Local

Esta guía explica cómo ejecutar el proyecto en un entorno local sin depender de ningún servicio de Manus. El sistema usa autenticación propia con email y contraseña, almacenamiento S3-compatible (o local de fallback), y adaptadores configurables para LLM, notificaciones y mapas.

---

## Requisitos previos

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Node.js | 22.x | Recomendado: instalar con [nvm](https://github.com/nvm-sh/nvm) |
| pnpm | 9.x | `npm install -g pnpm` |
| MySQL | 8.0+ | O MariaDB 10.6+. También puedes usar Docker (ver más abajo) |
| Docker + Compose | 24.x | Solo si prefieres contenedores para la BD y MinIO |

---

## Opción A — Arranque rápido con Docker (recomendado)

Esta opción levanta la base de datos MySQL y MinIO (S3 local) automáticamente.

```bash
# 1. Clonar / descomprimir el proyecto
cd nayade_experiences_platform

# 2. Copiar la plantilla de variables de entorno
cp env.example.txt .env
# Edita .env y ajusta los valores que necesites (ver sección Variables de entorno)

# 3. Levantar infraestructura (BD + MinIO)
docker compose up -d db minio

# 4. Instalar dependencias Node
pnpm install

# 5. Aplicar migraciones de base de datos
pnpm drizzle-kit push

# 6. Crear el primer usuario administrador
node scripts/create-admin.mjs

# 7. Arrancar el servidor de desarrollo
pnpm dev
```

La aplicación estará disponible en **http://localhost:3000**.

La consola de MinIO (gestión de archivos) estará en **http://localhost:9001** (usuario: `minioadmin`, contraseña: `minioadmin`).

---

## Opción B — MySQL propio (sin Docker)

Si ya tienes MySQL instalado en tu máquina:

```bash
# Crear la base de datos
mysql -u root -p -e "CREATE DATABASE nayade_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'nayade'@'localhost' IDENTIFIED BY 'nayade_pass';"
mysql -u root -p -e "GRANT ALL PRIVILEGES ON nayade_db.* TO 'nayade'@'localhost'; FLUSH PRIVILEGES;"

# Copiar y editar variables de entorno
cp env.example.txt .env
# Ajusta DATABASE_URL en .env

# Instalar dependencias y migrar
pnpm install
pnpm drizzle-kit push

# Crear usuario admin
node scripts/create-admin.mjs

# Arrancar
pnpm dev
```

---

## Variables de entorno clave

Edita el archivo `.env` (creado a partir de `env.example.txt`) con los siguientes valores mínimos para arrancar:

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión MySQL | `mysql://nayade:nayade_pass@localhost:3306/nayade_db` |
| `LOCAL_AUTH` | Activa auth local (imprescindible en local) | `true` |
| `JWT_SECRET` | Clave secreta para JWT (mín. 32 chars) | *(cambiar obligatoriamente)* |
| `PORT` | Puerto del servidor | `3000` |
| `NODE_ENV` | Entorno | `development` |

### Variables opcionales por módulo

**Email (SMTP)** — necesario para emails de confirmación de reserva:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password
SMTP_FROM=Nayade Experiences <reservas@nayadeexperiences.es>
ADMIN_EMAIL=admin@nayadeexperiences.es
```

**Almacenamiento S3** — para subida de imágenes (MinIO local con Docker ya configurado):

```
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=nayade-media
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_PUBLIC_URL=http://localhost:9000/nayade-media
```

Si no configuras S3, los archivos se guardan en `/tmp/local-storage` (solo para desarrollo).

**LLM / IA** — para funciones de inteligencia artificial (opcional):

```
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

Si no se configura, las funciones de IA devuelven respuestas de aviso en lugar de errores.

**Google Maps** — para el mapa de ubicación:

```
GOOGLE_MAPS_API_KEY=AIza...
VITE_GOOGLE_MAPS_API_KEY=AIza...
```

**Redsys (TPV)** — para pagos con tarjeta:

```
REDSYS_ENVIRONMENT=test
REDSYS_MERCHANT_CODE=999008881
REDSYS_MERCHANT_KEY=sq7HjrUOBfKmC576ILgskD5srU870gJ7
REDSYS_MERCHANT_TERMINAL=1
```

---

## Crear el bucket en MinIO

Tras levantar MinIO con Docker, crea el bucket `nayade-media` desde la consola web:

1. Abre **http://localhost:9001** en el navegador.
2. Inicia sesión con `minioadmin` / `minioadmin`.
3. Ve a **Buckets → Create Bucket** y crea `nayade-media`.
4. En la configuración del bucket, establece **Access Policy → Public** para que las URLs sean accesibles directamente.

---

## Autenticación local

Con `LOCAL_AUTH=true`, el sistema usa login propio en lugar de Manus OAuth. El flujo es:

- `POST /api/auth/login` — recibe `{ email, password }`, devuelve cookie JWT.
- `POST /api/auth/logout` — borra la cookie.
- `GET /api/auth/me` — devuelve el usuario de la sesión.

El frontend detecta automáticamente el modo local y muestra un formulario de login en lugar del botón de OAuth de Manus.

### Crear el primer administrador

```bash
node scripts/create-admin.mjs
```

El script pedirá email, nombre y contraseña de forma interactiva. También puedes pasarlos como variables de entorno:

```bash
ADMIN_EMAIL=admin@nayade.es ADMIN_NAME="Administrador" ADMIN_PASS=MiClave123 node scripts/create-admin.mjs
```

---

## Adaptadores de servicios externos

Todos los servicios de Manus han sido reemplazados por adaptadores en `server/adapters/`:

| Adaptador | Archivo | Reemplaza |
|---|---|---|
| LLM | `adapters/llm.ts` | `server/_core/llm.ts` (Manus Forge) |
| Storage | `adapters/storage.ts` | `server/storage.ts` (Manus Storage) |
| Notificaciones | `adapters/notification.ts` | `server/_core/notification.ts` (Manus Notify) |
| Generación de imágenes | `adapters/imageGeneration.ts` | `server/_core/imageGeneration.ts` |
| Google Maps | `adapters/maps.ts` | `server/_core/map.ts` (proxy Manus) |

Para usar los adaptadores en lugar de los helpers de Manus, importa desde `server/adapters/` en lugar de `server/_core/` o `server/storage.ts`.

---

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `pnpm dev` | Servidor de desarrollo con HMR (Vite + Express) |
| `pnpm build` | Build de producción (cliente Vite + servidor TS) |
| `pnpm start` | Arrancar el build de producción |
| `pnpm test` | Ejecutar tests Vitest |
| `pnpm drizzle-kit push` | Aplicar el schema a la BD sin generar migraciones |
| `pnpm drizzle-kit generate` | Generar archivos de migración SQL |
| `node scripts/create-admin.mjs` | Crear/actualizar el usuario administrador |

---

## Despliegue en servidor propio (producción)

Para desplegar en un VPS o servidor dedicado con todo en Docker:

```bash
# Construir y levantar todos los servicios
docker compose up -d --build

# Crear el usuario admin en el contenedor
docker compose exec app node scripts/create-admin.mjs
```

Asegúrate de cambiar las contraseñas por defecto (`JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MINIO_ROOT_PASSWORD`) antes de exponer el servicio en internet.

---

## Diferencias respecto al entorno Manus

| Funcionalidad | Entorno Manus | Entorno local |
|---|---|---|
| Autenticación | OAuth Manus (SSO) | Email + contraseña + JWT propio |
| Almacenamiento de archivos | Manus Storage (S3 interno) | AWS S3 / MinIO / disco local |
| LLM / IA | Manus Forge API | OpenAI / Ollama / cualquier API compatible |
| Generación de imágenes | Manus Image Service | OpenAI DALL-E / mock |
| Notificaciones al owner | Manus Notification Service | Email SMTP / log en consola |
| Google Maps | Proxy autenticado Manus | API key propia de Google |
| Base de datos | MySQL gestionado por Manus | MySQL/MariaDB propio |

---

## Resolución de problemas frecuentes

**"DATABASE_URL no está definida"** — Asegúrate de que el archivo `.env` existe en la raíz del proyecto y contiene `DATABASE_URL`.

**"Cannot connect to MySQL"** — Verifica que el contenedor Docker `nayade_db` esté corriendo (`docker compose ps`) y que el puerto 3306 no esté bloqueado.

**Las imágenes subidas no se ven** — Si usas MinIO, comprueba que el bucket `nayade-media` tiene política pública. Si usas almacenamiento local, las rutas `/local-storage/...` solo funcionan en desarrollo.

**"LLM_API_KEY no configurada"** — Las funciones de IA devuelven respuestas de aviso en lugar de errores. Configura `LLM_API_KEY` en `.env` si necesitas IA real.

**El mapa no carga** — Añade `GOOGLE_MAPS_API_KEY` y `VITE_GOOGLE_MAPS_API_KEY` en `.env` con una clave válida de Google Cloud Console.
