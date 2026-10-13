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
| 2026-10-14 | En `single` solo cuentan los ajustes `theme_*`; `brand_*_color` heredados no alteran el aspecto | Hotfix #54: evitar cambiar el diseño de Náyade |
| 2026-10-14 | En multi la web pública usa el shell neutro del tenant (páginas `static_pages` saneadas, pie y marca propios) | No mostrar contenido de otra empresa |
| 2026-10-14 | Credenciales de integraciones: bóveda cifrada por tenant (AES-256-GCM, AAD tenant|proveedor|campo); `integrationEnv()` la lee en multi y el entorno en single | Un cobro/mensaje de un tenant no puede salir por la cuenta de otro |
| 2026-10-14 | Los ajustes de marca/seo viven en `system_settings`; los secretos, en `integration_credentials` (migración 0001) | Separación de datos sensibles |
| 2026-10-14 | SSO: OIDC → sesión corta propia con ámbitos; lista explícita de operadores (sin comodines) | Personas con SSO, automatizaciones con tokens de servicio |
| 2026-10-14 | El CRM comercial vive en el servicio del plano de control (BD `db/crm`) y su SPA en repo propio | Un único backend de administración; extraíble |
| 2026-10-14 | Activar un contrato aprovisiona el tenant y arranca la prueba; los cobros siguen apagados | Flujo comercial completo sin cobros reales |
| 2026-10-14 | Módulos nuevos/externos: SDK ESM + `ELEPHANT_MODULES`; hotel/spa/restaurants siguen siendo built-in licenciados | Extraer sus routers tRPC exige plugin tipado en el cliente (pendiente) |
| 2026-10-14 | Cobros: doble candado `BILLING_PROVIDER` + `BILLING_CHARGES_ENABLED=true`; sin ambos el motor factura sin cobrar y no degrada | Autorización explícita antes de cobrar |
