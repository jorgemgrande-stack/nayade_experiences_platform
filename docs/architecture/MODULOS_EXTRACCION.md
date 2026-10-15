# Módulos: catálogo y extracción a repositorios propios

Estado: **preparado, sin extraer código**. Decisión vigente (DECISIONS 2026-10-14): hotel, spa y
restaurants siguen *built-in* licenciados hasta que exista el plugin tipado de routers tRPC en el
cliente (B14). Este documento fija el contrato, el catálogo y los pasos para extraer sin romper el Core.

## Contrato de módulo 1.1 (compatible con 1.0)
`server/_core/modules/contract.ts`. Campos 1.0: `id`, `name`, `version`, `kind` (core/sector/addon),
`coreRange` (semver), `dependsOn`, `permissions` (prefijo `<id>.`), `navigation`, `featureFlags`,
`migrationsDir`, `includedInBase`. Nuevos en 1.1 (opcionales):

| Campo | Uso |
|---|---|
| `description` | Texto del catálogo/marketplace |
| `resources` | Métricas del Resource Manager que consume (`email.sent`, `storage.write.bytes`…) |
| `source` | `{ location: "core" \| "external", repository?: "https://…" }` |

Licencia = `tenant_entitlements` (sin cambios). Las reglas de activación las aplica el plano de
control: no se activa un módulo sin sus dependencias disponibles y no se retira uno con dependientes
activos ni uno incluido en la base (409).

## Catálogo (plano de control)
- `GET /cp/v1/modules` (`tenants:read`): versión, compatibilidad con el Core, dependencias y
  dependientes, permisos, recursos, migraciones, origen, disponibilidad (base, planes que lo
  incluyen, precio como complemento) y empresas con licencia activa. Los planes salen del catálogo
  comercial cuando el motor lo expone (PR #62, `getCatalog`); si no, `commercialCatalog: false`.
- `GET /cp/v1/tenants/:id/modules`: estado por empresa (incluido, activo, suspendido, caducado,
  inactivo), dependencias que faltan, dependientes activos e inclusión en su plan.

## Extracción de un módulo (lista de comprobación)
1. Crear el repositorio desde `elephant-module-template` (SDK ESM; se carga con `ELEPHANT_MODULES`).
2. Mover manifiesto, migraciones propias (`migrationsDir`) y lógica de servidor; el Core deja de
   declararlo en `builtin.ts` y lo recibe del cargador (mismo `id`: las licencias no cambian).
3. Prefijo de permisos `<id>.` y navegación declarada; nada de imports desde `server/` del Core:
   solo el SDK.
4. Pruebas de compatibilidad obligatorias en el repo del módulo: `validateManifest`, `coreRange`
   satisfecho por la versión del Core objetivo, dependencias resolubles sin ciclos, migraciones
   verificables (`scripts/db/migrate.ts verify --dir …`).
5. En el Core: la prueba del catálogo debe seguir listando el módulo con el mismo `id`, y las rutas
   del módulo siguen protegidas por `requireModule` / `moduleRouteGuard`.
6. Desplegar primero en un entorno con `TENANT_MODE=multi` de pruebas; nunca activar multi en
   producción sin autorización.

## Piloto recomendado
Un módulo **nuevo** (p. ej. `ski`, dependiente de `commerce`) desarrollado desde la plantilla, sin
mover código heredado: valida el circuito completo (manifiesto 1.1, licencia, catálogo, cuotas por
recurso, migraciones propias) sin riesgo para hotel/spa/restaurants. La extracción de estos tres
queda después de B14.
