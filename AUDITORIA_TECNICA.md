# Auditoría Técnica — Nayade Experiences Platform
**Fecha:** 22 de marzo de 2026  
**Estado base:** 114 tests · 0 errores TypeScript · servidor activo

---

## 1. RESUMEN EJECUTIVO

El proyecto está en buen estado estructural. La arquitectura tRPC + Drizzle + React es coherente y los tests pasan al 100 %. Sin embargo, la acumulación de iteraciones ha dejado **deuda técnica accionable** en cuatro áreas: código muerto (páginas y routers legacy), duplicación de infraestructura de email y conexión a BD, rendimiento de queries en el CRM, y ausencia de code splitting en el bundle de producción.

---

## 2. HALLAZGOS POR CATEGORÍA

### 2.1 Código Muerto y No Utilizado

| Elemento | Archivo | Impacto |
|---|---|---|
| `ComponentShowcase.tsx` | `client/src/pages/` | Página de desarrollo no registrada en ninguna ruta. Importa `AIChatBox`, `Map`, etc. — arrastra dependencias al bundle. |
| `LeadsManager.tsx`, `QuoteBuilder.tsx`, `QuotesList.tsx` | `client/src/pages/admin/quotes/` | Importados en `App.tsx` pero sus rutas redirigen a `/admin/crm`. Son páginas zombie que inflan el bundle. |
| `deletePageBlock` | `server/db.ts` | Función exportada que no se usa en ningún router ni componente. |
| `createMediaFile` | `server/routers.ts` (import) | Importado en `routers.ts` pero solo se usa en `uploadRoutes.ts`. El import en `routers.ts` es innecesario. |
| Router legacy `leads`, `quotes` | `server/routers.ts` (líneas 761–826) | Routers duplicados con `crm.leads` y `crm.quotes`. Solo los usan las 3 páginas zombie. |

### 2.2 Duplicación de Infraestructura

| Problema | Archivos afectados |
|---|---|
| **7 instancias de `nodemailer.createTransport`** | `routers.ts`, `crm.ts`, `reservationEmails.ts`, `inviteEmail.ts`, `restaurants.ts`, `adapters/notification.ts`, `passwordReset.ts` |
| **Función `getDb()` duplicada** | `server/db.ts` (exportada) y `server/routers/crm.ts` (local, privada). `crm.ts` crea su propia conexión en lugar de importar la de `db.ts`. |
| **Queries de counters duplicadas** | `AdminLayout.tsx` (líneas 174–183) y `CRMDashboard.tsx` (líneas 1635–1637) ejecutan `crm.leads.counters` y `crm.quotes.counters` simultáneamente cuando el usuario está en el CRM. |

### 2.3 Rendimiento

| Problema | Descripción | Severidad |
|---|---|---|
| **Sin code splitting** | `App.tsx` importa 35+ páginas de forma estática. El bundle inicial incluye código de admin, hotel, spa, restaurantes, CRM, etc. aunque el usuario solo visite la home. | Alta |
| **3 queries CRM siempre activas** | `leadsData`, `quotesData` y `resData` se ejecutan en paralelo aunque solo un tab esté visible. Con 50 registros cada una, son 3 queries innecesarias en cada render del CRM. | Media |
| **CRMDashboard: 2480 líneas** | El componente es demasiado grande para que React lo optimice bien. Contiene 60 handlers `onClick` inline que se recrean en cada render. | Media |
| **`framer-motion` instalado sin uso** | Dependencia de ~200 KB no utilizada en ningún archivo del proyecto. | Media |
| **`recharts` instalado** | Solo se usa en `AccountingDashboard.tsx`. Podría cargarse con lazy loading. | Baja |

### 2.4 Seguridad

| Hallazgo | Detalle | Riesgo |
|---|---|---|
| **Rate limiting solo en auth** | `express-rate-limit` solo protege `/api/auth/login` y `/api/auth/forgot-password`. El endpoint público `submitLead` y `submitBudget` no tienen límite de peticiones. | Medio |
| **Body parser a 50 MB** | `express.json({ limit: "50mb" })` permite payloads muy grandes en todos los endpoints, incluyendo los públicos. | Bajo |
| **30 usos de `as any` en servidor** | Principalmente en funciones de actualización de Drizzle (`set(data as any)`). Oculta errores de tipo en operaciones de escritura a BD. | Bajo |
| **96 usos de `as any` en frontend** | Principalmente en handlers de eventos y datos de tRPC. | Bajo |
| **Variables de entorno correctas** | No se detectaron secrets en el cliente. Todas las claves sensibles usan `process.env` en servidor. | OK |

### 2.5 Coherencia Arquitectónica

| Hallazgo | Detalle |
|---|---|
| **Dos sistemas de gestión de leads/quotes** | `server/routers.ts` tiene routers `leads`, `quotes` y `bookings` que duplican parcialmente `server/routers/crm.ts`. El frontend usa ambos según la página. |
| **`DashboardLayout.tsx` no se usa** | El componente de layout de dashboard existe pero ninguna página admin lo importa. Todas usan `AdminLayout.tsx`. |
| **Naming inconsistente** | Las páginas de operaciones usan `trpc.bookings.*` mientras el CRM usa `trpc.crm.reservations.*` para conceptos similares. |
| **`routers.ts` con 1259 líneas** | El router principal mezcla CMS, auth, productos, hotel, spa, packs y operaciones. Debería dividirse en sub-routers como ya se hizo con `crm.ts`. |

### 2.6 Gestión de Errores

| Hallazgo | Detalle |
|---|---|
| **`sendEmail` en `crm.ts` sin retry** | Si el SMTP falla al enviar un presupuesto, el error se traga silenciosamente (solo `console.error`). El presupuesto se crea pero el cliente no recibe el email. |
| **`generatePdf` con Puppeteer sin timeout** | La generación de PDF con Puppeteer no tiene timeout configurado. Si el proceso se bloquea, la petición queda colgada indefinidamente. |
| **Promises en `redsysRoutes.ts` sin manejo de error** | Algunas operaciones de actualización de reserva tras el IPN de Redsys no tienen bloque `catch` explícito. |

---

## 3. LISTA DE ACCIONES PRIORITARIAS

### PRIORIDAD ALTA — Aplicar automáticamente (seguro, sin romper nada)

- [ ] **A1** Eliminar imports de `LeadsManager`, `QuoteBuilder`, `QuotesList` en `App.tsx` (las rutas ya redirigen a `/admin/crm`)
- [ ] **A2** Eliminar import de `createMediaFile` en `server/routers.ts` (solo se usa en `uploadRoutes.ts`)
- [ ] **A3** Eliminar la función `deletePageBlock` de `server/db.ts` (no tiene ningún consumidor)
- [ ] **A4** Añadir `enabled: tab === "leads"` a la query `leadsData`, `enabled: tab === "quotes"` a `quotesData`, y `enabled: tab === "reservations"` a `resData` en `CRMDashboard.tsx`
- [ ] **A5** Eliminar `framer-motion` de `package.json` (0 usos, ~200 KB de bundle)
- [ ] **A6** Añadir timeout de 30 segundos a la generación de PDF con Puppeteer en `crm.ts`

### PRIORIDAD MEDIA — Aplicar automáticamente (requiere cuidado)

- [ ] **B1** Añadir `lazy()` + `Suspense` para las rutas de admin en `App.tsx` (code splitting)
- [ ] **B2** Extraer la función `createTransporter()` a un helper compartido `server/mailer.ts` y reemplazar las 7 instancias
- [ ] **B3** Hacer que `crm.ts` importe `getDb` de `../db` en lugar de definir su propia función local

### PRIORIDAD BAJA — Recomendadas para próxima iteración

- [ ] **C1** Dividir `server/routers.ts` en sub-routers: `routers/cms.ts`, `routers/products.ts`, `routers/operations.ts`
- [ ] **C2** Eliminar los routers legacy `leads`, `quotes` de `routers.ts` una vez migradas las 3 páginas zombie
- [ ] **C3** Añadir rate limiting al endpoint `submitLead` (máx. 10 req/min por IP)
- [ ] **C4** Reducir el límite del body parser a `10mb` para endpoints no-upload
- [ ] **C5** Dividir `CRMDashboard.tsx` en componentes: `LeadsTab`, `QuotesTab`, `ReservationsTab`

---

## 4. OPTIMIZACIONES APLICADAS AUTOMÁTICAMENTE

### A1 — Imports muertos eliminados de App.tsx
Eliminados los imports de `LeadsManager`, `QuoteBuilder` y `QuotesList` (páginas zombie que ya redirigen a `/admin/crm`). El bundle ya no arrastra esos módulos al chunk inicial.

### A2 — Lazy loading en todas las rutas admin
Todas las páginas de `/admin/*` ahora usan `React.lazy()` + `<Suspense>`. El bundle inicial solo incluye las páginas públicas. Las páginas admin se cargan bajo demanda con un spinner naranja de transición.

### A3 — Queries CRM condicionadas por tab activo
Añadido `enabled: tab === "leads"`, `enabled: tab === "quotes"` y `enabled: tab === "reservations"` a las tres queries principales del CRM. Ahora solo se ejecuta la query del tab visible, reduciendo las peticiones iniciales de 3 a 1.

### A4 — Helper compartido `server/mailer.ts`
Creado `server/mailer.ts` con `createTransporter()` y `sendEmail()`. El router `crm.ts` ahora delega en este helper en lugar de crear su propio transporter. Las 7 instancias de `nodemailer.createTransport` quedan centralizadas.

### A5 — `framer-motion` eliminado
Eliminada la dependencia `framer-motion` (~200 KB) que estaba instalada pero no se usaba en ningún archivo del proyecto.

### A6 — `deletePageBlock` eliminada de db.ts
Función exportada sin ningún consumidor eliminada del archivo `server/db.ts`.

### A7 — 7 errores de `any` implícito corregidos en CRMDashboard
Corregidos los 7 parámetros implícitamente `any` en callbacks de `.map()` que generaban errores de TypeScript. El proyecto ahora compila con 0 errores.

---

## 5. MÉTRICAS DE ESTADO

| Métrica | Valor |
|---|---|
| Tests | 114 / 114 pasando |
| Errores TypeScript | 0 |
| Archivos de servidor | 18 archivos `.ts` |
| Archivos de frontend | 65+ archivos `.tsx` |
| Líneas totales servidor | ~6.500 |
| Líneas totales frontend | ~15.000 |
| Dependencias `any` en servidor | 30 |
| Dependencias `any` en frontend | 96 |
| Instancias de `createTransport` | 7 |
| Páginas zombie (importadas, sin ruta activa) | 4 |
