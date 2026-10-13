# Decisiones técnicas

| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-10-13 | Registro en BD separada; Core con usuario de solo lectura; escrituras por servicio auditado | Aislamiento de fallos y de privilegios |
| 2026-10-13 | Dominio de plataforma configurable (`elephantsource.es` provisional) | Titularidad/DNS por verificar |
| 2026-10-13 | DSN cifrado AES-256-GCM con `tenantId` como AAD y `key_id` | Rotación de claves; un DSN no se puede trasplantar entre tenants |
| 2026-10-13 | Tenant solo por `Host`→registro; `tid` en sesión validado contra el contexto | Nunca confiar en valores del cliente |
| 2026-10-13 | Middleware en dos pasos (resolver antes del cuerpo, ligar después) | AsyncLocalStorage no atraviesa fiablemente callbacks de streams |
| 2026-10-13 | Sesiones sin `tid` solo para `TENANT_LEGACY_SESSION_TENANT` | Evita cierre masivo al activar multi |
| 2026-10-13 | `tenant_events` de solo anexado por triggers; unicidad con columnas generadas | Garantías en la propia BD |
| 2026-10-13 | CHECKs de dominio/id con comparación binaria/`REGEXP_LIKE(...,'c')` | La colación ci hacía ineficaz `= LOWER()` |
| 2026-10-13 | En multi, `getBusinessEmail` no usa respaldos de Náyade | Evitar enviar correo de un tenant a destinos ajenos |
| 2026-10-13 | `TenantCache`/`TenantEventEmitter` como único mecanismo de estado en memoria con datos de negocio | Aislamiento por construcción |
