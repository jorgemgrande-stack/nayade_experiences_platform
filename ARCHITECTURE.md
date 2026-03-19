# ARCHITECTURE.md — Arquitectura Técnica del Sistema

Documentación técnica de la arquitectura de la plataforma **Nayade Experiences**. Este documento describe las decisiones de diseño, la estructura del sistema, el flujo de datos y las integraciones externas.

---

## Visión General

La plataforma es una aplicación web monolítica con separación clara entre cliente y servidor, comunicados exclusivamente a través de **tRPC** (TypeScript Remote Procedure Call). Esta elección garantiza seguridad de tipos de extremo a extremo: los tipos definidos en el servidor son automáticamente disponibles en el cliente sin necesidad de archivos de contrato separados ni generación de código.

El servidor es un proceso único **Node.js** que sirve tanto la API tRPC como los assets estáticos del cliente compilado por Vite. En desarrollo, Vite corre como middleware dentro del mismo proceso Express, lo que simplifica el arranque y elimina problemas de CORS.

```
┌─────────────────────────────────────────────────────┐
│                   Cliente (React 19)                 │
│  Wouter (routing) + TanStack Query + tRPC Client    │
└─────────────────────┬───────────────────────────────┘
                      │ HTTP (tRPC over JSON)
                      │ /api/trpc/*
┌─────────────────────▼───────────────────────────────┐
│              Servidor (Express 4 + Node.js)          │
│  tRPC Router → Procedures → DB Helpers → Drizzle    │
│  Middleware: authGuard, multer, redsys, cors         │
└─────────────────────┬───────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
┌───────▼──────┐          ┌─────────▼────────┐
│  MySQL 8     │          │  S3 / MinIO       │
│  (Drizzle)   │          │  (archivos)       │
└──────────────┘          └──────────────────┘
```

---

## Capa de Presentación (Cliente)

### Tecnologías Principales

El cliente está construido con **React 19** y compilado con **Vite 7**. El enrutado usa **Wouter** (alternativa ligera a React Router) con rutas declarativas en `client/src/App.tsx`. El estado del servidor se gestiona con **TanStack Query** a través de los hooks de tRPC, eliminando la necesidad de Redux o Zustand para la mayoría de los casos de uso.

Los componentes de interfaz provienen de **shadcn/ui**, una colección de componentes construidos sobre **Radix UI** (accesibles, sin estilos propios) y estilizados con **Tailwind CSS 4**. Los formularios usan **React Hook Form** con validación **Zod** en el cliente, y los mismos esquemas Zod se reutilizan en el servidor para validar los inputs de los procedimientos tRPC.

### Estructura del Cliente

```
client/src/
├── App.tsx              ← Definición de todas las rutas
├── main.tsx             ← Providers: QueryClient, tRPC, Theme
├── index.css            ← Variables CSS globales (tokens de diseño)
├── const.ts             ← Constantes y helper getLoginUrl()
├── lib/
│   ├── trpc.ts          ← Cliente tRPC con superjson
│   └── utils.ts         ← Utilidades (cn, formatters)
├── _core/hooks/
│   └── useAuth.ts       ← Hook de estado de autenticación
├── contexts/
│   └── ThemeContext.tsx  ← Proveedor de tema claro/oscuro
├── components/
│   ├── ui/              ← Componentes shadcn/ui (50+ componentes)
│   ├── PublicLayout.tsx  ← Layout con nav y footer para páginas públicas
│   ├── AdminLayout.tsx   ← Layout con sidebar para el panel de admin
│   ├── ReviewSection.tsx ← Sección de reseñas reutilizable
│   ├── BookingModal.tsx  ← Modal de confirmación de reserva
│   └── Map.tsx          ← Componente Google Maps
└── pages/
    ├── (páginas públicas)
    ├── Login.tsx
    ├── ForgotPassword.tsx
    ├── ResetPassword.tsx
    └── admin/
        ├── AdminDashboard.tsx
        ├── cms/
        ├── products/
        ├── operations/
        ├── accounting/
        ├── hotel/
        ├── spa/
        ├── quotes/
        └── users/
```

### Sistema de Diseño

El sistema de diseño se basa en tokens CSS definidos en `client/src/index.css` siguiendo la convención de shadcn/ui. Los colores principales son:

| Token | Valor | Uso |
|---|---|---|
| `--background` | `#0d1b2a` (oscuro) / blanco (claro) | Fondo principal |
| `--foreground` | Blanco / oscuro | Texto principal |
| Acento naranja | `#f5a623` | CTAs, botones primarios, énfasis |
| Acento azul | `#3b82f6` | Links, estados activos |

La tipografía usa las fuentes del sistema con fallback a sans-serif. Los iconos provienen de **Lucide React**.

---

## Capa de API (tRPC)

### Filosofía

tRPC elimina la necesidad de definir endpoints REST manualmente. Los procedimientos son funciones TypeScript tipadas que el cliente puede llamar como si fueran funciones locales. El tipo `AppRouter` exportado desde `server/routers.ts` es importado por el cliente tRPC, proporcionando autocompletado y verificación de tipos en tiempo de compilación.

### Estructura del Router

El `appRouter` en `server/routers.ts` organiza los procedimientos en namespaces. Los sub-routers más grandes tienen su propio archivo en `server/routers/`:

```
appRouter
├── system          ← Notificaciones al owner
├── auth            ← Login, logout, me, registro, invitaciones
├── public          ← Datos públicos sin autenticación
│   ├── getExperiences
│   ├── getHotelRooms
│   ├── getSpaTreatments
│   ├── getRestaurants
│   ├── getPacks
│   └── ...
├── cms             ← Gestión de contenidos (admin)
├── products        ← Gestión de productos (admin)
├── leads           ← Solicitudes de presupuesto
├── quotes          ← Presupuestos personalizados
├── bookings        ← Reservas de experiencias
├── accounting      ← Contabilidad y transacciones
├── admin           ← Operaciones de admin
├── homeModules     ← Módulos de la home
├── reservations    ← Reservas Redsys y webhooks GHL
├── packs           ← Packs de actividades
├── hotel           ← (server/routers/hotel.ts)
├── spa             ← (server/routers/spa.ts)
└── reviews         ← (server/routers/reviews.ts)
```

### Tipos de Procedimientos

```ts
publicProcedure      // Accesible sin autenticación
protectedProcedure   // Requiere sesión válida (cualquier usuario)
// Para admin: protectedProcedure + comprobación manual de ctx.user.role
```

### Contexto tRPC

El contexto (`ctx`) inyectado en cada procedimiento contiene:

```ts
interface Context {
  user: {
    id: string;
    email: string;
    name: string;
    role: 'admin' | 'user';
    avatarUrl?: string;
  } | null;
  req: express.Request;
  res: express.Response;
}
```

En modo `LOCAL_AUTH`, el contexto se construye en `server/_core/context.local.ts` verificando la cookie JWT. En modo Manus, lo construye `server/_core/context.ts` usando el SDK de Manus.

---

## Capa de Datos (Drizzle ORM + MySQL)

### Decisiones de Diseño

Se eligió **Drizzle ORM** por su filosofía SQL-first: el schema TypeScript es una representación directa de las tablas SQL, sin abstracciones mágicas. Las migraciones se generan como SQL puro, lo que facilita la revisión y el control de versiones.

La base de datos es **MySQL 8** (compatible con MariaDB 10.6+). En el entorno Manus se usa una instancia gestionada; en local se usa un contenedor Docker o una instalación propia.

### Modelo de Datos

El schema completo está en `drizzle/schema.ts`. Las 35 tablas se organizan en los siguientes dominios:

**Usuarios y Autenticación**

La tabla `users` almacena usuarios con roles `admin` / `user`, hash de contraseña bcrypt, avatar y timestamps. La tabla `password_reset_tokens` gestiona los tokens de recuperación de contraseña con TTL de 60 minutos.

**Contenido (CMS)**

Las tablas `slideshow_items`, `menu_items`, `media_files`, `static_pages`, `page_blocks` y `home_module_items` gestionan todo el contenido editable desde el panel de admin. Los archivos multimedia se almacenan en S3/MinIO y solo se guarda la URL en BD.

**Productos**

Las tablas `experiences`, `experience_variants`, `categories`, `locations`, `packs` y `pack_cross_sells` modelan el catálogo de productos. Cada experiencia puede tener múltiples variantes de precio y duración. Los packs pueden tener cross-sells que se muestran como sugerencias en el checkout.

**Reservas y Pagos**

La tabla `bookings` registra las reservas de experiencias con todos los datos del cliente, la variante seleccionada, el estado del pago Redsys y el importe. La tabla `reservations` almacena las reservas procesadas por el webhook de Redsys/GHL. La tabla `transactions` es el registro contable de todas las operaciones económicas.

**Hotel**

Las tablas `room_types`, `room_rate_seasons`, `room_rates` y `room_blocks` modelan el sistema de gestión hotelera. Los precios se organizan en temporadas (alta, media, baja) con tarifas por noche para cada combinación de habitación y temporada. Los bloqueos permiten marcar fechas como no disponibles.

**SPA**

Las tablas `spa_categories`, `spa_treatments`, `spa_resources`, `spa_slots` y `spa_schedule_templates` modelan el sistema de gestión del SPA. Los recursos son las cabinas, piscinas o salas donde se realizan los tratamientos. Los slots son las franjas horarias disponibles para cada recurso. Las plantillas de horario permiten generar slots de forma masiva.

**Reseñas**

La tabla `reviews` almacena las valoraciones de clientes para habitaciones y tratamientos. Cada reseña tiene un estado de moderación (`pending`, `approved`, `rejected`), un campo de respuesta del equipo y una marca de reserva verificada.

**CRM y Leads**

Las tablas `leads`, `quotes` y `ghl_webhook_logs` gestionan el pipeline de ventas. Los leads son solicitudes de presupuesto entrantes. Los quotes son presupuestos personalizados generados por el equipo. Los webhooks de GHL permiten sincronizar el estado de las reservas con el CRM externo.

---

## Capa de Autenticación

### Modo Local (LOCAL_AUTH=true)

El flujo de autenticación local funciona de la siguiente manera. El cliente envía las credenciales a `POST /api/auth/login`. El servidor verifica el hash bcrypt de la contraseña almacenada en BD. Si es correcto, genera un JWT firmado con `JWT_SECRET` (algoritmo HS256, TTL 30 días) y lo establece como cookie HttpOnly. En cada petición, el middleware `authGuard.ts` verifica la cookie antes de que llegue al router tRPC, y el contexto tRPC extrae el usuario del JWT para inyectarlo en `ctx.user`.

```
Cliente                    Servidor
  │                           │
  ├─ POST /api/auth/login ───►│
  │                           ├─ bcrypt.compare(password, hash)
  │                           ├─ jose.SignJWT(payload)
  │◄─ Set-Cookie: session ────┤
  │                           │
  ├─ GET /api/trpc/auth.me ──►│
  │                           ├─ authGuard: verify JWT cookie
  │                           ├─ context.ts: decode JWT → ctx.user
  │◄─ { user: {...} } ────────┤
```

### Modo Manus OAuth

En el entorno Manus, la autenticación usa el protocolo OAuth 2.0 gestionado por `server/_core/oauth.ts`. El flujo redirige al usuario al portal de Manus, que devuelve un código de autorización. El servidor lo intercambia por un token de sesión que se almacena en una cookie. El SDK de Manus (`server/_core/sdk.ts`) verifica la sesión en cada petición.

### Middleware de Protección

El archivo `server/authGuard.ts` implementa un middleware Express que se ejecuta antes del handler de tRPC. Extrae el nombre del procedimiento de la URL (`/api/trpc/auth.me` → `auth.me`) y comprueba si está en la lista blanca de procedimientos públicos. Si no lo está y no hay sesión válida, devuelve HTTP 401 con el formato de error estándar de tRPC.

---

## Integraciones Externas

### Redsys (Pasarela de Pago)

La integración con Redsys TPV virtual usa el módulo `server/redsys.ts` para generar los parámetros firmados del formulario de pago (HMAC-SHA256). El flujo es:

1. El cliente solicita los parámetros de pago a `trpc.bookings.createPaymentForm`.
2. El servidor genera el formulario firmado y lo devuelve al cliente.
3. El cliente redirige al TPV de Redsys con el formulario.
4. Redsys notifica el resultado al webhook `POST /api/redsys/notification`.
5. El servidor actualiza el estado de la reserva y registra la transacción.
6. Redsys redirige al usuario a `/reserva/ok` o `/reserva/error`.

### GoHighLevel (CRM)

Los webhooks de GHL (`server/routers.ts` → `reservations.ghlWebhook`) permiten recibir actualizaciones de estado de reservas desde el CRM. Los logs se almacenan en `ghl_webhook_logs` para auditoría.

### Google Maps

El componente `client/src/components/Map.tsx` usa la API de Google Maps JavaScript. En el entorno Manus, la autenticación es automática a través del proxy de Manus. En local, requiere una API key propia configurada en `GOOGLE_MAPS_API_KEY` y `VITE_GOOGLE_MAPS_API_KEY`.

### Almacenamiento de Archivos (S3/MinIO)

Los archivos se suben al servidor mediante `multer` (middleware de Express) y luego se transfieren a S3/MinIO usando el AWS SDK v3. El servidor devuelve la URL pública del archivo, que se almacena en BD. En local, el adaptador `server/adapters/storage.ts` puede usar MinIO (compatible con S3) o guardar en disco (`/tmp/local-storage`) si no hay S3 configurado.

### Email (SMTP / Nodemailer)

Los emails transaccionales (confirmaciones de reserva, invitaciones, recuperación de contraseña) se envían con **Nodemailer**. En el entorno Manus, se usa el servicio de notificaciones de Manus. En local, se configura un servidor SMTP estándar (Gmail, SendGrid, Mailgun, etc.) mediante las variables `SMTP_*`. Sin SMTP configurado, los emails se imprimen en la consola del servidor.

---

## Flujo de Desarrollo

### Añadir una Nueva Funcionalidad

El flujo estándar para añadir una nueva funcionalidad sigue cuatro pasos en orden:

**1. Schema** — Añadir o modificar tablas en `drizzle/schema.ts` y ejecutar `pnpm drizzle-kit push` para sincronizar con la BD.

**2. Helpers de BD** — Crear funciones helper en `server/db.ts` o en un nuevo archivo `server/myFeatureDb.ts`. Estas funciones encapsulan las queries Drizzle y devuelven los datos crudos.

**3. Procedimientos tRPC** — Añadir procedimientos en `server/routers.ts` o en un nuevo archivo `server/routers/myFeature.ts`. Los procedimientos validan el input con Zod, comprueban permisos y llaman a los helpers de BD.

**4. UI** — Crear o modificar componentes en `client/src/pages/` usando los hooks `trpc.*.useQuery()` y `trpc.*.useMutation()`. Registrar nuevas rutas en `client/src/App.tsx`.

### Gestión de Estado en el Frontend

El estado del servidor (datos de la API) se gestiona exclusivamente con TanStack Query a través de los hooks de tRPC. No se usa Redux ni Zustand para datos del servidor. Para estado local de UI (modales abiertos, tabs activos, etc.) se usa `useState` de React.

Las mutaciones que modifican listas usan **actualizaciones optimistas** (`onMutate` → `onError` rollback → `onSettled` invalidate) para dar feedback inmediato al usuario. Las operaciones críticas (pagos, cambios de rol) usan `invalidate` en `onSuccess` con estados de carga explícitos.

---

## Configuración de Entornos

### Variables de Entorno por Entorno

| Variable | Desarrollo Local | Producción | Manus |
|---|---|---|---|
| `DATABASE_URL` | MySQL local/Docker | MySQL propio | Inyectado por Manus |
| `LOCAL_AUTH` | `true` | `true` | No definido |
| `JWT_SECRET` | Cualquier string | String aleatorio seguro | Inyectado por Manus |
| `NODE_ENV` | `development` | `production` | `production` |
| `S3_ENDPOINT` | `http://localhost:9000` | URL de S3/MinIO | Inyectado por Manus |
| `SMTP_HOST` | Opcional (log en consola) | Requerido | Inyectado por Manus |
| `REDSYS_ENVIRONMENT` | `test` | `real` | Configurado manualmente |

### Docker Compose (Local)

El archivo `docker-compose.yml` define tres servicios:

- **`db`**: MySQL 8 con base de datos `nayade_db`, usuario `nayade` y contraseña `nayade_pass`. Datos persistidos en volumen Docker.
- **`minio`**: MinIO compatible con S3. Consola web en puerto 9001. Datos persistidos en volumen Docker.
- **`app`**: Servidor Node.js construido con el `Dockerfile` multi-stage. Solo se usa en producción con `docker compose up app`.

---

## Seguridad

**Autenticación.** Las contraseñas se almacenan con bcrypt (coste 12). Los tokens JWT usan HS256 con `JWT_SECRET` de al menos 32 caracteres. Las cookies de sesión son HttpOnly y SameSite=Lax.

**Autorización.** El middleware `authGuard.ts` protege todas las rutas `/api/trpc` no públicas a nivel de red. Los procedimientos protegidos verifican adicionalmente la sesión en el contexto tRPC. Las operaciones de admin comprueban `ctx.user.role === 'admin'` antes de ejecutar.

**Validación de inputs.** Todos los inputs de procedimientos tRPC se validan con esquemas Zod antes de llegar a la lógica de negocio. Los uploads de archivos tienen límites de tamaño configurados en multer.

**Tokens de recuperación.** Los tokens de recuperación de contraseña son strings aleatorios de 32 bytes (hex) generados con `crypto.randomBytes`. Tienen TTL de 60 minutos y se invalidan tras el primer uso.

**Variables de entorno.** Los secretos nunca se hardcodean en el código. Se leen desde `process.env` a través de `server/_core/env.ts`, que valida que las variables requeridas estén presentes al arrancar el servidor.
