# CLAUDE.md — Guía de Contexto para Claude

Este archivo proporciona a Claude (en VS Code o cualquier entorno de desarrollo) todo el contexto necesario para trabajar de forma efectiva en el proyecto **Nayade Experiences Platform**. Léelo al inicio de cada sesión de trabajo.

---

## Identidad del Proyecto

**Nayade Experiences** es una plataforma de e-commerce y gestión para un complejo de turismo activo y naturaleza situado en Los Ángeles de San Rafael (Segovia), a 45 minutos de Madrid. El complejo ofrece experiencias acuáticas, hotel, SPA, restaurantes y packs de actividades. Esta plataforma gestiona la web pública, las reservas online (con pasarela Redsys), el CMS de contenidos y el panel de administración completo.

---

## ⚠️ Reglas Operativas (LEER ANTES DE CUALQUIER ACCIÓN)

Estas reglas se establecieron tras un incidente el 2026-05-02 en el que un bucle de fixes encadenados sin verificar deploy generó 22 commits rotos apilados sobre `main` y bloqueó producción durante horas. El tag `wip-broken-fixes-2026-05-02` conserva ese estado como referencia.

### Trabajo en ramas — nunca commits directos a main

Toda modificación se hace en una rama propia con prefijo descriptivo: `fix/...`, `feat/...`, `chore/...`, `refactor/...`. Si detectas que estás en `main`, ejecuta `git checkout -b <rama>` antes de tocar nada. El push a `main` solo ocurre vía merge desde una rama verificada.

### Un cambio = un commit = un deploy verificado

Después de cada push a `main`, espera a que Railway complete el build y verifica en logs que el contenedor arranca limpio (mensaje `Server running on http://localhost:3000/` y jobs registrándose sin errores) **antes** de hacer cualquier otro commit. No encadenes commits "para arreglar" sin haber visto el resultado del anterior en producción.

### Prohibición absoluta de fixes en cascada

Si un commit hace que el deploy falle o que arranque con errores, **NO encadenes otro commit para parchear**. La acción correcta es:

1. Revertir el commit roto (`git revert <SHA>`) o resetear si aún no se ha hecho push
2. Identificar la causa real del fallo en local antes de tocar producción
3. Probar el fix en una rama separada con verificación local

Encadenar `fix(railway): X` → `fix(railway): Y` → `fix(railway): Z` cuando cada uno falla es exactamente el patrón a evitar.

### Cambios de infraestructura van aislados

Cualquier modificación a `Dockerfile`, `package.json`, `pnpm-lock.yaml`, `railway.toml`, `drizzle.config.ts`, `scripts/migrate.mjs`, configuración de Vite, configuración de TypeScript (`tsconfig.json`), variables de entorno o startup del servidor (`server/_core/index.ts` partes de bootstrap) se hace en commit aislado, en rama propia, **sin mezclar features**. Verifica el deploy de ese commit antes de continuar con cualquier otra cosa. Estos cambios afectan a cómo arranca el contenedor — un fallo aquí es un downtime, no un bug visual.

### Migraciones y schema — nunca en startup

NO añadir `drizzle-kit migrate` ni equivalentes al script de arranque del servidor. Las migraciones se generan con `pnpm drizzle-kit generate`, se revisan manualmente, y se aplican como paso explícito antes del deploy o vía un script separado. Un servidor que migra al arrancar puede colgarse silenciosamente y dejar la BD en estado intermedio.

Antes de añadir tablas o columnas nuevas, verifica que el schema en producción está sincronizado con `drizzle/schema.ts`. Si hay drift, arréglalo en un commit dedicado a la migración antes de seguir con la feature.

### Comandos git destructivos los lanza el humano

El agente NO ejecuta sin confirmación explícita en lenguaje natural del usuario:

- `git push --force` ni `git push -f` ni `git push --force-with-lease`
- `git reset --hard` sobre commits ya pusheados
- `git rebase` interactivo sobre `main`
- `git branch -D` ni `git tag -d` sobre tags o ramas remotas
- Borrar el tag `wip-broken-fixes-2026-05-02` (conserva 22 commits de respaldo)

Si el agente cree que uno de estos comandos es necesario, debe parar y pedirlo explícitamente.

### Perímetro estricto en cada tarea

Cuando recibas una tarea acotada (ej. "fix de scroll en /admin/tpv"), modifica únicamente los archivos directamente implicados. NO refactorices código adyacente, NO "limpies imports", NO añadas comentarios explicativos, NO cambies el formato de líneas que no estás tocando funcionalmente. Si crees que un cambio fuera del perímetro mejora la solución, pregunta antes.

### Verificación local antes de push

Antes de cualquier push a `main`, verifica que:

1. El cambio funciona en local (`pnpm dev` arranca sin errores nuevos en consola)
2. `git status` muestra solo los archivos esperados como modificados
3. `git diff` solo contiene el cambio descrito en el commit, sin ediciones colaterales
4. `pnpm test` pasa si hay tests relacionados con el cambio

### Deploy de Railway es la fuente de verdad

El SHA del último deploy `Active` en Railway es el código que sirve tráfico real. Si `main` en GitHub diverge del SHA activo (porque hay commits pusheados que no han desplegado o que han fallado), prioriza investigar esa divergencia antes de añadir nuevo código. Para identificar el SHA activo: Railway → servicio → Deployments → click en el deploy Active → "Deployed via GitHub" → click en el mensaje del commit te lleva a GitHub con el SHA completo.

### Tag de respaldo intocable

`wip-broken-fixes-2026-05-02` contiene 22 commits del incidente del 02/05/2026, incluyendo el trabajo en `feat(partners): Landing Partners Fase 1 y 2` (`225e47d`, `b688c0c`, `f5362ad`) que se quiere recuperar más adelante con cherry-pick. **No borrar nunca este tag.**

---

## Stack Tecnológico

El proyecto usa un stack moderno y tipado de extremo a extremo. En el servidor corre **Express 4** con **tRPC 11** como capa de API, **Drizzle ORM** sobre **MySQL 8**, y **TypeScript** en todo el código. En el cliente corre **React 19** con **Vite 7**, **Tailwind CSS 4**, **shadcn/ui** (componentes Radix UI), **TanStack Query** (a través de tRPC) y **Wouter** para el enrutado. Los formularios usan **React Hook Form** con validación **Zod**.

---

## Reglas de Desarrollo (OBLIGATORIAS)

Estas reglas deben respetarse en todo momento para mantener la coherencia del proyecto.

**Nunca uses fetch o Axios directamente en el frontend.** Toda comunicación con el servidor debe hacerse a través de los hooks de tRPC: `trpc.*.useQuery()` y `trpc.*.useMutation()`. La única excepción son los endpoints de autenticación local (`/api/auth/*`) que son REST puro.

**Toda lógica de base de datos va en `server/db.ts` o en archivos `server/*Db.ts`.** Los procedimientos tRPC en `server/routers.ts` (o en `server/routers/*.ts`) llaman a esas funciones helper; no deben contener SQL inline.

**El schema de base de datos es la fuente de verdad.** Cualquier cambio en `drizzle/schema.ts` debe ir seguido de `pnpm drizzle-kit push` (desarrollo) o `pnpm drizzle-kit generate` + aplicar la migración SQL (producción).

**Los procedimientos protegidos usan `protectedProcedure`.** Los públicos usan `publicProcedure`. Nunca expongas datos sensibles en procedimientos públicos. Para operaciones exclusivas de admin, añade la comprobación `if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' })`.

**Los assets estáticos (imágenes, vídeos) no van en `client/public/` ni en `client/src/assets/`.** Deben subirse a S3/MinIO y referenciarse por URL CDN. En local, el adaptador de storage guarda en `/tmp/local-storage` durante desarrollo.

**Los tests Vitest son obligatorios** para cualquier lógica de negocio nueva. Los archivos de test van en `server/*.test.ts`. Ejecuta `pnpm test` antes de hacer commit.

---

## Estructura de Archivos Clave

```
drizzle/schema.ts          ← Modelo de datos completo (35 tablas)
server/routers.ts          ← Router tRPC principal (todos los módulos)
server/routers/hotel.ts    ← Router del módulo Hotel
server/routers/spa.ts      ← Router del módulo SPA
server/routers/reviews.ts  ← Router del sistema de reseñas
server/db.ts               ← Helpers de BD genéricos
server/hotelDb.ts          ← Helpers de BD para Hotel
server/spaDb.ts            ← Helpers de BD para SPA
server/db/reviewsDb.ts     ← Helpers de BD para Reseñas
server/localAuth.ts        ← Autenticación local (email+JWT)
server/passwordReset.ts    ← Recuperación de contraseña
server/authGuard.ts        ← Middleware de protección de rutas
server/adapters/           ← Adaptadores para servicios externos
client/src/App.tsx         ← Rutas de la aplicación
client/src/pages/          ← Páginas públicas y de admin
client/src/components/     ← Componentes reutilizables
```

---

## Módulos tRPC Disponibles

El `appRouter` expone los siguientes namespaces, cada uno con sus procedimientos:

| Namespace | Descripción | Archivo |
|---|---|---|
| `auth` | Login, logout, me, registro, invitaciones | `server/routers.ts` |
| `public` | Datos públicos: experiencias, packs, hotel, SPA, restaurantes | `server/routers.ts` |
| `cms` | Gestión de contenidos: slideshow, menús, páginas, multimedia, módulos home | `server/routers.ts` |
| `products` | Gestión de experiencias, packs, categorías, ubicaciones, variantes | `server/routers.ts` |
| `leads` | Solicitudes de presupuesto y leads de contacto | `server/routers.ts` |
| `quotes` | Presupuestos personalizados con constructor | `server/routers.ts` |
| `bookings` | Reservas de experiencias (con Redsys) | `server/routers.ts` |
| `accounting` | Dashboard contable y listado de transacciones | `server/routers.ts` |
| `admin` | Operaciones de administración general | `server/routers.ts` |
| `homeModules` | Módulos configurables de la página de inicio | `server/routers.ts` |
| `reservations` | Reservas Redsys y webhooks GHL | `server/routers.ts` |
| `packs` | Packs de actividades con cross-sells | `server/routers.ts` |
| `hotel` | Habitaciones, tarifas, temporadas, reservas de hotel | `server/routers/hotel.ts` |
| `spa` | Tratamientos, recursos, slots, reservas de SPA | `server/routers/spa.ts` |
| `reviews` | Reseñas públicas y moderación de admin | `server/routers/reviews.ts` |
| `system` | Notificaciones al owner | `server/_core/systemRouter.ts` |

---

## Modelo de Datos (Tablas Principales)

El proyecto tiene 35 tablas en MySQL. Las más importantes para el desarrollo cotidiano son:

| Tabla | Propósito |
|---|---|
| `users` | Usuarios con roles `admin` / `user`, hash de contraseña, avatar |
| `experiences` | Experiencias acuáticas con precio, duración, capacidad, imágenes |
| `experience_variants` | Variantes de precio/duración por experiencia |
| `packs` | Packs de actividades con precio, incluidos, cross-sells |
| `bookings` | Reservas de experiencias con estado Redsys y datos del cliente |
| `reservations` | Reservas procesadas por Redsys (webhook GHL) |
| `room_types` | Tipos de habitación con capacidad, precio base, amenities |
| `room_rate_seasons` | Temporadas de precios para habitaciones |
| `room_rates` | Tarifas por noche para cada temporada y habitación |
| `room_blocks` | Bloqueos de disponibilidad de habitaciones |
| `spa_treatments` | Tratamientos del SPA con duración, precio, categoría |
| `spa_slots` | Disponibilidad de slots de SPA por fecha y recurso |
| `reviews` | Reseñas de hotel y SPA con moderación y respuesta de admin |
| `leads` | Solicitudes de presupuesto con estado y seguimiento |
| `quotes` | Presupuestos personalizados con líneas de detalle |
| `transactions` | Registro contable de todas las transacciones |
| `password_reset_tokens` | Tokens de recuperación de contraseña (TTL 60 min) |
| `static_pages` | Páginas CMS con bloques de contenido |
| `menu_items` | Ítems del menú de navegación con orden y visibilidad |
| `slideshow_items` | Slides del carrusel de la home |
| `home_module_items` | Módulos configurables de la página de inicio |

---

## Rutas de la Aplicación

### Rutas Públicas

| Ruta | Componente | Descripción |
|---|---|---|
| `/` | `Home.tsx` | Página de inicio con módulos configurables |
| `/experiencias` | `Experiences.tsx` | Catálogo de experiencias acuáticas |
| `/experiencias/:slug` | `ExperienceDetail.tsx` | Detalle y reserva de experiencia |
| `/packs` | `PacksHome.tsx` | Página de inicio de packs |
| `/packs/:category` | `PacksList.tsx` | Listado de packs por categoría |
| `/packs/:category/:slug` | `PackDetail.tsx` | Detalle y reserva de pack |
| `/hotel` | `Hotel.tsx` | Buscador y listado de habitaciones |
| `/hotel/:slug` | `HotelRoom.tsx` | Ficha de habitación con calendario, precios y reseñas |
| `/spa` | `Spa.tsx` | Catálogo de tratamientos del SPA |
| `/spa/:slug` | `SpaDetail.tsx` | Detalle de tratamiento con reserva y reseñas |
| `/restaurantes` | `Restaurantes.tsx` | Listado de restaurantes |
| `/restaurantes/:slug` | `RestauranteDetail.tsx` | Detalle de restaurante |
| `/galeria` | `Gallery.tsx` | Galería multimedia |
| `/ubicaciones` | `Locations.tsx` | Mapa e información de ubicación |
| `/presupuesto` | `BudgetRequest.tsx` | Formulario de solicitud de presupuesto |
| `/contacto` | `Contact.tsx` | Formulario de contacto |
| `/pagina/:slug` | `DynamicPage.tsx` | Páginas CMS dinámicas |

### Rutas de Autenticación

| Ruta | Componente | Descripción |
|---|---|---|
| `/login` | `Login.tsx` | Formulario de login local (email + contraseña) |
| `/recuperar-contrasena` | `ForgotPassword.tsx` | Solicitud de recuperación de contraseña |
| `/nueva-contrasena` | `ResetPassword.tsx` | Formulario de nueva contraseña con token |
| `/establecer-contrasena` | `SetPassword.tsx` | Primera configuración de contraseña por invitación |

### Rutas de Admin

Todas las rutas admin requieren autenticación y rol `admin`. El AdminLayout proporciona el sidebar de navegación.

| Sección | Ruta base | Descripción |
|---|---|---|
| Dashboard | `/admin` | Resumen de métricas y accesos rápidos |
| CMS | `/admin/cms/*` | Slideshow, menús, páginas, multimedia, módulos home |
| Productos | `/admin/productos/*` | Experiencias, packs, categorías, ubicaciones, variantes |
| Presupuestos | `/admin/presupuestos/*` | Leads, lista de presupuestos, constructor |
| Operaciones | `/admin/operaciones/*` | Calendario, reservas, órdenes diarias, Redsys, reseñas |
| Contabilidad | `/admin/contabilidad/*` | Dashboard contable, transacciones |
| Hotel | `/admin/hotel` | Gestión de habitaciones, tarifas y temporadas |
| SPA | `/admin/spa` | Gestión de tratamientos, recursos y slots |
| Usuarios | `/admin/usuarios` | Gestión de usuarios y roles |
| Configuración | `/admin/configuracion` | Ajustes generales del sitio |

---

## Patrones de Código Frecuentes

### Añadir un nuevo procedimiento tRPC

```ts
// En server/routers.ts o server/routers/feature.ts
myFeature: router({
  getAll: publicProcedure
    .input(z.object({ page: z.number().default(1) }))
    .query(async ({ input }) => {
      return await getMyFeatureItems(input.page);
    }),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
      return await createMyFeatureItem(input);
    }),
}),
```

### Consumir datos en el frontend

```tsx
// Consulta
const { data, isLoading } = trpc.myFeature.getAll.useQuery({ page: 1 });

// Mutación con invalidación
const utils = trpc.useUtils();
const create = trpc.myFeature.create.useMutation({
  onSuccess: () => utils.myFeature.getAll.invalidate(),
});
```

### Añadir una tabla nueva

1. Editar `drizzle/schema.ts` y añadir la tabla con `mysqlTable`.
2. Ejecutar `pnpm drizzle-kit push` (desarrollo) o generar migración SQL.
3. Crear helpers en `server/db.ts` o un nuevo archivo `server/myFeatureDb.ts`.
4. Añadir procedimientos en `server/routers.ts` o `server/routers/myFeature.ts`.
5. Registrar el sub-router en el `appRouter` si es un archivo separado.

---

## Autenticación

El proyecto soporta dos modos de autenticación configurables mediante la variable de entorno `LOCAL_AUTH`:

Cuando `LOCAL_AUTH=true`, se usa autenticación propia con email y contraseña. El módulo `server/localAuth.ts` gestiona el login, logout y la verificación de sesión mediante cookies JWT firmadas con `JWT_SECRET`. El middleware `server/authGuard.ts` protege las rutas `/api/trpc` que no están en la lista blanca pública.

Cuando `LOCAL_AUTH` no está definido (entorno Manus), se usa el OAuth de Manus gestionado por `server/_core/oauth.ts` y el SDK de Manus.

El frontend detecta el modo activo mediante la variable `VITE_LOCAL_AUTH` inyectada por Vite desde el `.env`, y muestra el formulario de login propio o el botón de OAuth según corresponda.

---

## Servicios Externos y Adaptadores

Todos los servicios externos tienen adaptadores en `server/adapters/` que permiten sustituir los servicios de Manus por alternativas estándar en entorno local:

| Servicio | Adaptador | Variables de entorno |
|---|---|---|
| LLM / IA | `adapters/llm.ts` | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| Almacenamiento | `adapters/storage.ts` | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Email / Notificaciones | `adapters/notification.ts` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Generación de imágenes | `adapters/imageGeneration.ts` | `LLM_API_KEY` (usa DALL-E) |
| Google Maps | `adapters/maps.ts` | `GOOGLE_MAPS_API_KEY` |
| Pagos (Redsys) | `server/redsys.ts` | `REDSYS_MERCHANT_CODE`, `REDSYS_MERCHANT_KEY`, etc. |

---

## Variables de Entorno Imprescindibles

```bash
DATABASE_URL=mysql://nayade:nayade_pass@localhost:3306/nayade_db
LOCAL_AUTH=true
JWT_SECRET=clave-secreta-de-al-menos-32-caracteres
PORT=3000
NODE_ENV=development
```

Consulta `env.example.txt` para la lista completa con descripciones.

---

## Comandos Útiles

```bash
pnpm dev                    # Servidor de desarrollo (Express + Vite HMR)
pnpm build                  # Build de producción
pnpm test                   # Ejecutar tests Vitest
pnpm drizzle-kit push       # Sincronizar schema con BD (desarrollo)
pnpm drizzle-kit generate   # Generar SQL de migración (producción)
node scripts/create-admin.mjs   # Crear/actualizar usuario admin
node scripts/setup-minio.mjs    # Inicializar bucket MinIO
docker compose up -d db minio   # Levantar MySQL + MinIO con Docker
```

---

## Convenciones de Nomenclatura

Los archivos de componentes React usan **PascalCase** (`HotelRoom.tsx`). Los archivos de servidor usan **camelCase** (`hotelDb.ts`). Las tablas de base de datos usan **snake_case** (`room_rate_seasons`). Los procedimientos tRPC usan **camelCase** (`getPublicReviews`). Las rutas URL usan **kebab-case** (`/recuperar-contrasena`).
