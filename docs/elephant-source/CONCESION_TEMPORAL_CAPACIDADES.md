# Concesión temporal de capacidades

Herramienta administrativa del plano de control (Core `server/controlPlane`) para conceder una capacidad individual,
**de forma temporal**, a una empresa de pruebas (p. ej. `accounting-general`, que no es uno de los módulos de la pestaña
Licencias). No crea contratos, facturas, suscripciones ni cargos.

## Uso (API del plano de control)

- `GET  /cp/v1/tenants/:id/temporary-capabilities`: estado (`enabled`, `environment`, `maxHours`, `allowedCapabilities`,
  `eligible`), concesiones de operador y su historial.
- `POST /cp/v1/tenants/:id/temporary-capabilities` con `{ capabilityId, reason, expiresAt }` (`expiresAt` en ms epoch).
- `POST /cp/v1/tenants/:id/temporary-capabilities/:capabilityId/suspend` con `{ reason }`.

Errores: `{ "error": "<mensaje en español>" }` con 400, 403, 404 o 409.

## Límites

- Permiso propio `capabilities:grant-temporary`, solo en los roles `superadmin` y `admin`, y solo para operadores
  identificados (no para tokens de servicio).
- Listas cerradas en `server/controlPlane/temporaryCapabilities.ts`: `TEMPORARY_CAPABILITY_TENANTS` y
  `TEMPORARY_CAPABILITY_IDS`. Para ampliarlas hay que abrir un PR; no hay configuración en caliente.
- Motivo obligatorio (10 a 200 caracteres) y caducidad obligatoria, futura y de **24 h como máximo**
  (`MAX_TEMP_CAPABILITY_HOURS`).
- **Production queda cerrada**: con `RAILWAY_ENVIRONMENT_NAME` = `production` (sin distinguir mayúsculas ni espacios) las tres
  rutas responden 403 y `GET` devuelve `enabled: false`. La herramienta escribe solo en el registro del propio entorno.
- Una sola concesión vigente por empresa y capacidad: otra igual responde 409 (para ampliar, suspender y conceder de nuevo).
  Si la capacidad ya la concede una suscripción o una prueba, responde 409 y no se modifica nada.
- Limitación: el registro no conoce a los usuarios de cada empresa (están en su base de datos), por lo que no se puede
  impedir que un operador conceda a una empresa de la que también es usuario. Lo mitigan la lista cerrada de empresas de
  prueba, el permiso específico y el registro de cada acción.

## Auditoría

Cada concesión o suspensión escribe un evento en `tenant_capability_events` (operador `operator:<id>`, capacidad, estado
anterior y nuevo, `source = operator`, y en `reason` la caducidad y el motivo, p. ej.
`temporal hasta 2026-11-28T12:00Z · <motivo>`) y una entrada en la auditoría de la empresa del registro
(`capability.temporary_granted` / `capability.temporary_suspended`).

## Caducidad

- El acceso lo decide `decide()`: una concesión de `source = operator` activa y vencida no permite ni lectura (`expired`).
  Las suscripciones y pruebas vencidas siguen en solo lectura, como antes.
- El proceso del plano de control ejecuta un barrido cada 60 s (`CP_TEMP_CAPABILITY_SWEEP_SECONDS`, mínimo 10) que pasa a
  `suspended` las vencidas con el evento `system:expiry` y el motivo «caducidad automática». Es idempotente.
- El Core lee el registro con una caché de 30 s: la suspensión manual o la caducidad llegan al Core en ese margen
  (la caducidad por reloj se aplica en cada decisión, sin esperar al barrido).
