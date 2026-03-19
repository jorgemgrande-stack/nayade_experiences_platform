# PROGRESS.md — Estado del Proyecto y Registro de Versiones

Documento de seguimiento del desarrollo de la plataforma **Nayade Experiences**. Registra el historial de versiones, el estado actual de cada módulo y el trabajo pendiente.

**Última actualización:** Marzo 2026 — v7.3

---

## Estado General del Proyecto

El proyecto se encuentra en fase de **desarrollo activo**. La plataforma web pública está completamente funcional con todas las secciones de contenido, el sistema de reservas con pasarela de pago Redsys, el hotel con calendario de precios, el SPA con gestión de slots, el sistema de reseñas con moderación, y el panel de administración completo. El proyecto es además exportable y ejecutable en local de forma independiente, sin depender de ningún servicio externo de Manus.

---

## Historial de Versiones

### v7.3 — Documentación completa (Marzo 2026)

Esta versión añade los tres documentos de referencia del proyecto (`CLAUDE.md`, `PROGRESS.md`, `ARCHITECTURE.md`) para facilitar el trabajo con Claude en VS Code y la incorporación de nuevos desarrolladores al proyecto.

### v7.2 — Recuperación de contraseña y middleware de seguridad (Marzo 2026)

Se implementó el flujo completo de recuperación de contraseña por email: tabla `password_reset_tokens` en BD, tres endpoints REST (`/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/validate-reset-token`), páginas `/recuperar-contrasena` y `/nueva-contrasena` con indicador de fortaleza de contraseña, y enlace "¿Olvidaste tu contraseña?" integrado en el formulario de login. Se añadió además el middleware `server/authGuard.ts` que protege todas las rutas `/api/trpc` no públicas devolviendo HTTP 401 con formato tRPC cuando no hay sesión válida.

### v7.1 — Login local y setup automático de MinIO (Marzo 2026)

Se creó la página `/login` con formulario de email y contraseña, diseño oscuro coherente con la plataforma, validación en tiempo real y toggle de contraseña visible. Se añadió el script `scripts/setup-minio.mjs` que crea el bucket, configura la política pública y las carpetas base de MinIO de forma completamente automática. Se adaptó `vite.config.ts` para inyectar `VITE_LOCAL_AUTH` desde el `.env` al frontend.

### v7.0 — Exportación local independiente de Manus (Marzo 2026)

Versión hito que hace el proyecto completamente autónomo. Se auditaron y reemplazaron todas las dependencias específicas de Manus: sistema de autenticación local con email+JWT (`server/localAuth.ts`), adaptadores para LLM, Storage S3, Notificaciones SMTP, Google Maps y generación de imágenes (`server/adapters/`), `docker-compose.yml` con MySQL 8 y MinIO, `Dockerfile` multi-stage para producción, `env.example.txt` con todas las variables documentadas, `README-LOCAL.md` con instrucciones paso a paso, y script `scripts/create-admin.mjs` para crear el primer usuario administrador.

### v6.4 — Fix selector de edades de niños (Marzo 2026)

Se reemplazó el `<select>` nativo del selector de edades de niños (que abría con fondo blanco del sistema operativo haciendo el texto invisible) por un selector custom con botones +/− siempre visible, en ambas ubicaciones: el panel lateral de la ficha de habitación y el buscador de la página de Hotel.

### v6.3 — Selector de niños con edades en Hotel (Marzo 2026)

Se añadió el selector de número de niños con edades individuales (0-17 años) tanto en el buscador principal de `/hotel` como en el panel lateral de reserva de `/hotel/:slug`. El campo `childrenAges` (array de enteros) se pasa al backend y se guarda en los detalles JSON de la reserva.

### v6.2 — Sistema de reseñas y valoraciones (Marzo 2026)

Implementación completa del sistema de opiniones: tabla `reviews` en BD con campos de moderación, helper `server/db/reviewsDb.ts`, router tRPC `server/routers/reviews.ts` con 7 procedimientos (consulta pública con estadísticas, envío, y 5 acciones de admin), componente `ReviewSection.tsx` reutilizable con estrellas interactivas, barra de distribución, listado paginado y formulario de envío, integración en `HotelRoom.tsx` y `SpaDetail.tsx`, y panel de moderación `ReviewsManager.tsx` en el admin. Se cargaron además 102 reseñas de muestra (80% positivas 4-5★, 20% normales 3★) para las 4 habitaciones del hotel y los 5 tratamientos principales del SPA.

### v6.1 — Módulo SPA completo (Febrero-Marzo 2026)

Implementación del módulo de SPA con gestión de categorías, tratamientos, recursos (cabinas, piscinas, salas), slots de disponibilidad y plantillas de horario. Panel de administración `SpaManager.tsx` con calendario de slots, gestión de recursos y configuración de tratamientos. Página pública `/spa` con catálogo filtrable y `/spa/:slug` con detalle, galería y sistema de reserva.

### v6.0 — Módulo Hotel completo (Febrero 2026)

Implementación del módulo de hotel con tipos de habitación, temporadas de precios, tarifas por noche, bloqueos de disponibilidad y reservas. Buscador de disponibilidad con filtros de fechas, adultos y niños. Calendario de precios interactivo en la ficha de habitación. Panel de administración `HotelManager.tsx` con gestión de habitaciones, tarifas y temporadas.

### v5.x — Módulo de Packs y Presupuestos (Enero-Febrero 2026)

Implementación de packs de actividades con cross-sells, constructor de presupuestos personalizados, gestión de leads y seguimiento de solicitudes. Integración con GoHighLevel (GHL) mediante webhooks para automatización de CRM.

### v4.x — Pasarela de Pago Redsys (Enero 2026)

Integración completa con Redsys TPV virtual: generación de formularios firmados, webhook de notificación, gestión de estados de pago (pendiente, completado, fallido, reembolsado), páginas de resultado `/reserva/ok` y `/reserva/error`, y registro de transacciones en contabilidad.

### v3.x — Panel de Administración (Diciembre 2025 - Enero 2026)

Construcción del panel de administración completo con AdminLayout y sidebar de navegación. Módulos de CMS (slideshow, menús, páginas dinámicas, multimedia, módulos home), gestión de productos (experiencias, categorías, ubicaciones, variantes), operaciones (calendario, reservas, órdenes diarias), contabilidad y gestión de usuarios con roles.

### v2.x — Web Pública y Reservas de Experiencias (Noviembre-Diciembre 2025)

Implementación de la web pública completa: home con módulos configurables, catálogo de experiencias con filtros, detalle de experiencia con galería y formulario de reserva, galería multimedia, mapa de ubicación, formulario de contacto y solicitud de presupuesto.

### v1.0 — Scaffold inicial (Noviembre 2025)

Inicialización del proyecto con el template React 19 + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM + MySQL. Configuración de autenticación Manus OAuth, estructura de carpetas, componentes base de shadcn/ui y configuración de Vite.

---

## Estado Actual por Módulo

### Web Pública

| Sección | Estado | Notas |
|---|---|---|
| Home | Completo | Módulos configurables desde admin, slideshow, CTA |
| Experiencias | Completo | Catálogo con filtros, detalle con reserva y pasarela Redsys |
| Packs | Completo | Home de packs, listado por categoría, detalle con reserva |
| Hotel | Completo | Buscador con fechas/adultos/niños+edades, ficha con calendario de precios y reseñas |
| SPA | Completo | Catálogo, detalle con reserva de slots y reseñas |
| Restaurantes | Completo | Listado y detalle |
| Galería | Completo | Multimedia con filtros |
| Ubicación | Completo | Mapa Google Maps con información |
| Contacto | Completo | Formulario con notificación al admin |
| Presupuesto | Completo | Formulario de solicitud con lead en CRM |
| Páginas CMS | Completo | Páginas dinámicas gestionables desde admin |

### Panel de Administración

| Módulo | Estado | Notas |
|---|---|---|
| Dashboard | Completo | Métricas de reservas, leads, ingresos |
| CMS — Slideshow | Completo | Gestión de slides con imagen, título, CTA |
| CMS — Menús | Completo | Árbol de navegación con orden drag-and-drop |
| CMS — Páginas | Completo | Editor de páginas con bloques de contenido |
| CMS — Multimedia | Completo | Subida y gestión de archivos a S3 |
| CMS — Módulos Home | Completo | Configuración de secciones de la home |
| Productos — Experiencias | Completo | CRUD con variantes, imágenes, categorías |
| Productos — Packs | Completo | CRUD con cross-sells y configuración de precios |
| Productos — Categorías | Completo | Gestión de categorías y subcategorías |
| Productos — Ubicaciones | Completo | Puntos de interés con mapa |
| Productos — Variantes | Completo | Variantes de precio y duración |
| Presupuestos — Leads | Completo | Gestión de solicitudes con estados |
| Presupuestos — Lista | Completo | Listado de presupuestos generados |
| Presupuestos — Constructor | Completo | Builder de presupuestos personalizados |
| Operaciones — Calendario | Completo | Vista de reservas por fecha |
| Operaciones — Reservas | Completo | Listado con filtros y gestión de estados |
| Operaciones — Órdenes | Completo | Órdenes del día agrupadas por guía |
| Operaciones — Redsys | Completo | Reservas procesadas por TPV con estados |
| Operaciones — Reseñas | Completo | Moderación, respuesta y estadísticas |
| Contabilidad — Dashboard | Completo | Resumen de ingresos y métricas |
| Contabilidad — Transacciones | Completo | Registro detallado de todas las transacciones |
| Hotel | Completo | Habitaciones, tarifas, temporadas, bloqueos |
| SPA | Completo | Tratamientos, recursos, slots, plantillas de horario |
| Usuarios | Completo | CRUD de usuarios con roles admin/user |
| Configuración | Completo | Ajustes generales del sitio |

### Sistema de Autenticación

| Funcionalidad | Estado | Notas |
|---|---|---|
| Login local (email+JWT) | Completo | `server/localAuth.ts` |
| Logout | Completo | Borra cookie JWT |
| Recuperación de contraseña | Completo | Email con token TTL 60 min |
| Middleware de protección | Completo | `server/authGuard.ts` |
| Roles admin/user | Completo | Campo `role` en tabla `users` |
| Invitaciones por email | Completo | `server/inviteEmail.ts` |
| Manus OAuth (modo Manus) | Completo | `server/_core/oauth.ts` |

### Infraestructura Local

| Componente | Estado | Notas |
|---|---|---|
| Docker Compose (MySQL + MinIO) | Completo | `docker-compose.yml` |
| Dockerfile multi-stage | Completo | Build de producción optimizado |
| Script create-admin | Completo | `scripts/create-admin.mjs` |
| Script setup-minio | Completo | `scripts/setup-minio.mjs` |
| Adaptadores de servicios | Completo | LLM, Storage, Notificaciones, Mapas, Imágenes |
| README-LOCAL.md | Completo | Guía paso a paso de arranque local |

---

## Trabajo Pendiente y Mejoras Sugeridas

Las siguientes funcionalidades han sido identificadas como mejoras de alta prioridad pero aún no están implementadas:

**Puntuación media en tarjetas de listado.** Las páginas `/hotel` y `/spa` muestran las tarjetas de habitaciones y tratamientos sin la puntuación media de reseñas. Añadir las estrellas y la nota media directamente en las tarjetas aumentaría la confianza del usuario antes de entrar al detalle.

**Verificación automática de reseñas.** Actualmente el campo `verifiedBooking` de la tabla `reviews` se establece manualmente. Sería conveniente cruzar automáticamente el email del autor de la reseña con las reservas pagadas en BD para marcar la verificación de forma automática al enviar la reseña.

**Rate limiting en endpoints de autenticación.** Los endpoints `/api/auth/login` y `/api/auth/forgot-password` no tienen protección contra ataques de fuerza bruta. Añadir `express-rate-limit` con límites razonables (5 intentos por minuto) mejoraría la seguridad.

**Buscador de niños/edades en la Home.** Si existe un widget de búsqueda rápida en la página de inicio, debería incorporar el mismo selector de niños con edades que ya existe en `/hotel` y `/hotel/:slug`.

**Notificaciones en tiempo real.** El sistema actual envía emails para confirmaciones de reserva pero no tiene notificaciones push ni websockets para el panel de admin. Añadir notificaciones en tiempo real para nuevas reservas y leads mejoraría la experiencia del administrador.

**Tests de integración end-to-end.** Los tests actuales son unitarios (Vitest). Añadir tests E2E con Playwright para los flujos críticos (reserva de experiencia, reserva de hotel, login, recuperación de contraseña) aumentaría la confianza en los despliegues.
