# Estado de ejecución

> Fuente de verdad para reanudar en otra sesión. Se actualiza al cerrar cada bloque.
> Última actualización: 2026-10-13 (tras PR #41; billing en PR).

**Producción:** `TENANT_MODE=single`. Último despliegue verificado: `main` @ #41 (sondas `/healthz`, `/readyz`, `/kb.json`, `/api/redsys/health` 200; `/api/ghl/templates` 401; 0 errores en logs; tareas programadas arrancando correctamente).

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
| Suscripciones y facturación SaaS | I·T (PR) | catálogo parametrizable, sin tarifas; proveedor simulado |

## Cola (siguiente, en orden)
1. Fase 07 CMS/plantillas/dominios: verificación de dominios propios en vivo (DNS), plantillas iniciales, SEO por tenant (`vite.ts` fijo de Náyade), tema por tenant. Coordinar con Ventana 1.
2. Fase 08 operaciones: backup/restore verificable por tenant, migraciones por tenant (runner multi), diagnóstico, acceso delegado auditado, runbooks.
3. Fase 09 Big Elephant CRM: repositorio y API de operación (servicios sobre registro/ERM/billing/provisioning).
4. Fase 01B restante: pools de `_core/index.ts` (DDL de arranque en modo single), RBAC y pruebas Redsys ampliadas, CI más estricto.
5. Pruebas multi-tenant ampliadas con la app real (tRPC) sobre dos BD con baseline.

## Deuda conocida
- tsc: ~106–118 errores preexistentes (línea base); tests: 18 fallos preexistentes (BD real/otros).
- `server/_core/vite.ts` inyecta SEO fijo de Náyade (Fase 07).
- Correo/SMTP/Brevo/GHL/VAPI usan credenciales de entorno globales: falta configuración por tenant (Fase 07/08).
- Bucket S3 público: el aislamiento por prefijo no es control de acceso del proveedor (ver DECISIONS).
