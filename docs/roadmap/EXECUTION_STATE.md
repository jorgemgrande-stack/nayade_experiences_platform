# Estado de ejecución

> Fuente de verdad para reanudar en otra sesión. Se actualiza al cerrar cada bloque.
> Última actualización: 2026-10-14 (tras PR #58+ y #59).

**Producción:** `TENANT_MODE=single`. Último despliegue verificado en `main` (sondas 200/401 esperadas, 0 errores en logs). `/api/trpc/public.getTheme` no altera el aspecto de Náyade.

## Worktrees (Window 2)
`C:\Users\jgran\Documents\nayade_worktrees\{core-saas,core-int,core-pools,core-work}`; Window 1: `prod-features`.
node_modules: junction hacia `core-saas\node_modules`. MySQL de pruebas: contenedor `elephant-registry-mysql` (puerto 3317, root/testroot) con `REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test` para las pruebas opt-in `*.mysql.test.ts`.

## Flujo de integración
PR pequeño → CI informativo → `gh pr merge --merge` → esperar despliegue Railway → sondas → logs. Script reutilizable: `ship.sh <rama> <título>` (scratchpad de la sesión).

## Estado por componente (I implementado · T probado · M en main · D desplegado)
| Componente | Estado | Notas |
|---|---|---|
| Registro de tenants (contrato, servicio, resolutor, sombra, MySQL) | I·T·M·D | inactivo en `single` |
| Middleware multi, sesiones `tid`, jobs, CLI, aislamiento | I·T·M·D | |
| Cachés/SSE por tenant (`tenantScope`) | I·T·M·D | |
| Ficheros por tenant (`tenantStorage`) | I·T·M·D | prefijo `t/<id>/`; legado con `TENANT_LEGACY_STORAGE_TENANT` |
| Programador por tenant + arranque por modo | I·T·M·D | verificado en producción (jobs arrancan) |
| Módulos y licencias (contrato, registro, guardas, migraciones) | I·T·M·D | registro 0001 |
| ERM (medición, cuotas, limitadores, enforcement) | I·T·M·D | registro 0002, BD `db/erm`; activo solo en multi |
| Aprovisionamiento | I·T·M·D | registro 0003; E2E con MySQL real (152 tablas) |
| Suscripciones y facturación SaaS | I·T·M·D | catálogo parametrizable, sin tarifas; proveedor simulado; BD `db/billing` |
| Plano de control API `/cp/v1` | I·T·M·D | proceso separado (`server/controlPlane/main.ts`), tokens con ámbitos, CORS por lista |
| Operaciones (migraciones por tenant con canario, diagnóstico, copias verificadas) | I·T·M·D | runbook `OPERACIONES_MULTITENANT.md` |
| Soporte delegado temporal | I·T·M·D | registro 0004; requiere `SUPPORT_JWT_SECRET` |
| SEO por tenant en multi | I·T·M·D | `tenantSeo.ts` |
| Licencias en routers sectoriales (hotel/spa/restaurants) | I·T·M·D | `moduleRouteGuard`; single sin cambios |
| Prueba E2E multi-tenant con la app real (2 empresas, baseline completo) | I·T | `multiTenantApp.mysql.test.ts` |

| Tema/marca por tenant, sitio neutro, branding Big Elephant | I·T·M·D | `public.getTheme`, `getTenantPage`, páginas admin Marca y tema |
| Bóveda de credenciales + Integraciones (UI) | I·T·M·D | `integrations.*`, migración `0001_integration_credentials` |
| Navegación por módulos (`modules.active`) | I·T·M·D | `AdminLayout` oculta sectores sin licencia |
| CRM comercial (leads→contratos→alta) | I·T·M·D | `/cp/v1/crm`, BD `db/crm`; SPA con panel, leads, oportunidades, empresas, contratos, tareas |
| SSO OIDC del plano de control | I·T·M·D | `/cp/v1/auth/oidc`; SPA con Google Identity Services opcional |
| SDK y cargador de módulos externos + plantilla | I·T·M·D | repo `elephant-module-template`; `ELEPHANT_MODULES` |
| Incidencias, alertas y retención | I·T·M·D | registro 0005; `/cp/v1/incidents`, CLI |
| Adaptador de pagos (Stripe) con cobros apagados | I·T (PR) | doble candado |

## Cola (siguiente, en orden)
1. Plugin de routers tRPC tipado para extraer hotel/spa/restaurants (B14).
2. Despliegue del plano de control y del CRM (B12) y alta real de operadores SSO (B10).
3. Elegir proveedor de pagos y tarifas (B11) → activar cobros con autorización.
4. Facturación SaaS en el CRM (suscripciones/facturas visibles) y tickets de soporte.
5. Cifrado de campo de las credenciales heredadas en `system_settings` (GHL/VAPI de Náyade): **implementado y probado, NO ejecutado** (lectores compatibles + CLI `scripts/legacy-credentials.ts`; procedimiento en `docs/operations/CIFRADO_CREDENCIALES_HEREDADAS.md`). Pendiente: claves de producción (B9), backup verificado (B7) y autorización para ejecutar.
6. Fase 01B: pools/DDL de arranque de `_core/index.ts` en modo single, RBAC y pruebas Redsys ampliadas.

## Deuda conocida
- tsc: ~106–118 errores preexistentes (línea base); tests: 18 fallos preexistentes (BD real/otros).
- `server/_core/vite.ts` inyecta SEO fijo de Náyade (Fase 07).
- Correo/SMTP/Brevo/GHL/VAPI usan credenciales de entorno globales: falta configuración por tenant (Fase 07/08).
- Bucket S3 público: el aislamiento por prefijo no es control de acceso del proveedor (ver DECISIONS).
