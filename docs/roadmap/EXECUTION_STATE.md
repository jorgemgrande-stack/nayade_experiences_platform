# Estado de ejecución

> Fuente de verdad para reanudar en otra sesión. Se actualiza al cerrar cada bloque.
> Última actualización: 2026-10-14 (tras PR #47).

**Producción:** `TENANT_MODE=single`. Último despliegue verificado: `main` @ #47 (sondas 200/401 esperadas, 0 errores en logs; tareas programadas arrancando).

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
| Big Elephant CRM (repo `jorgemgrande-stack/big-elephant-crm`) | I·T | SPA inicial: empresas, dominios, licencias, cuotas, auditoría, soporte, alta |

## Cola (siguiente, en orden)
1. Fase 07: plantillas CMS iniciales (5), tema/marca por tenant en el cliente, navegación dinámica por módulos (cliente). Coordinar con Ventana 1.
2. Fase 06: adaptador real de proveedor de pagos y tarifas definitivas (bloqueado por decisión comercial); webhooks reales.
3. Fase 09: CRM comercial (leads, oportunidades, tickets), SSO/roles internos, despliegue de la SPA.
4. Fase 01B restante: pools/DDL de arranque de `_core/index.ts` (modo single), RBAC y pruebas Redsys ampliadas, CI estricto sobre las suites propias.
5. Extracción de módulos sectoriales a repositorios propios (hotel/spa/restaurants) sobre el contrato de módulos.
6. Configuración por tenant de integraciones (correo, GHL, VAPI, Redsys) en lugar de variables de entorno globales.

## Deuda conocida
- tsc: ~106–118 errores preexistentes (línea base); tests: 18 fallos preexistentes (BD real/otros).
- `server/_core/vite.ts` inyecta SEO fijo de Náyade (Fase 07).
- Correo/SMTP/Brevo/GHL/VAPI usan credenciales de entorno globales: falta configuración por tenant (Fase 07/08).
- Bucket S3 público: el aislamiento por prefijo no es control de acceso del proveedor (ver DECISIONS).
