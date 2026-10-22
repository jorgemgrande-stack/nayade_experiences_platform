# Multiempresa: acceso heredado a la base de datos

Estado: implementado en la rama `feat/elephant-multitenancy` (sin desplegar).
Ámbito: `TENANT_MODE=multi`. En `single` (Náyade en producción) y `shadow` el comportamiento es
exactamente el de antes.

## Problema

61 ficheros del servidor (CRM, TPV, caja, facturas, numeración, RRHH, hotel, spa, restaurantes,
proveedores, correo…) obtienen la base de datos de forma **síncrona** a nivel de módulo:

```ts
const db = legacyDb();     // o legacyPool()
```

`legacyDb()`/`legacyPool()` devuelven un Proxy perezoso que resuelve el destino en **cada acceso
de propiedad**. Hasta ahora, en `multi` ese destino no existía y todo acceso lanzaba
`TenantResolutionError`: ninguno de esos routers funcionaba en multiempresa.

## Diseño

Una base de datos por empresa; el tenant viaja en AsyncLocalStorage (`_core/tenant.ts`).

1. **Arriendo del pool en el borde.** `leaseTenantDatabase()` (`_core/dbRegistry.ts`) se llama
   DENTRO de `runWithTenant`: precarga el pool del tenant (`getTenantDatabase`, asíncrono),
   incrementa su contador de arriendos y lo asocia al objeto de contexto ALS en curso
   (`WeakMap<TenantContext, Entry>`).
2. **Acceso síncrono = pool arrendado por el contexto.** En `multi`, `getCurrentDatabaseSync()` /
   `getCurrentPoolSync()` (los usa el Proxy de `legacyDb`) devuelven **solo** el pool arrendado por
   el contexto actual, y comprueban que pertenece al mismo `tenantId`. No consultan el mapa global
   de pools: aunque el pool del tenant esté abierto, sin arriendo en ESTE contexto se lanza.
   - Sin contexto → `TenantResolutionError`.
   - Con contexto pero sin arriendo (no precargado) → `TenantResolutionError`.
   - Un `runWithTenant` anidado crea un contexto nuevo sin arriendo → lanza (no se hereda).
3. **Middleware de petición.** `bindTenantMiddleware` entra en el contexto, arrienda el pool y solo
   entonces llama a `next()`. El arriendo se libera en `finish`/`close` de la respuesta.
   Si el arriendo falla (tenant sin BD resoluble), la petición sigue **sin arriendo**: cualquier
   acceso heredado lanza (falla cerrado) y las rutas sin BD (estáticos, panel) no se rompen. Se
   registra `{"ctx":"TenantBinding","event":"db_lease_failed"}` sin datos sensibles.
4. **Jobs.** `runForEachTenant` (multi) ejecuta cada tenant con `withTenantDb(tenantId, fn)`:
   precarga + arriendo + ejecución + liberación. Un tenant sin BD resoluble queda registrado como
   error y su tarea no se ejecuta. Todos los jobs de `SCHEDULED_JOBS` pasan por
   `scheduleTenantCron` → `runTenantJob` → `runForEachTenant`.
5. **Helper público** para tareas internas y scripts: `withTenantDb(tenantId, fn)`. En `single`
   equivale a `runWithTenant(tenantId, fn)` sin arriendo.
6. **Expulsión LRU (máx. 50 pools) e invalidación.**
   - La LRU recorre del menos al más reciente y **salta los pools arrendados** y el recién creado.
     Si todos están en uso se tolera superar el máximo temporalmente (mejor eso que cerrar un pool
     en uso).
   - `evictTenantDatabase` (cambio de DSN, suspensión, sondeo de versiones) retira el pool del
     registro en el acto (las peticiones nuevas resuelven de nuevo) y, si hay arriendos, **aplaza
     `pool.end()`** hasta que se libere el último.
   - `leaseTenantDatabase` reintenta si el pool se retiró entre su creación y el arriendo.

Se eligió un contador de arriendos en lugar de «no cerrar nunca» o de un periodo de gracia porque
es determinista, no necesita temporizadores y su coste es un entero por pool.

## Garantías (con prueba)

| Garantía | Prueba |
|---|---|
| single: un único pool de `DATABASE_URL`, sin contexto, como hoy; `withTenantDb` y contextos no cambian nada; shadow igual | `server/tenantLegacyAccess.test.ts` («single») + `server/legacyDb.test.ts` |
| multi: con arriendo, el pool es el del tenant del contexto | `tenantLegacyAccess.test.ts` |
| multi: sin contexto, o con contexto sin arriendo, lanza y no abre pools | `tenantLegacyAccess.test.ts`, `legacyDb.test.ts`, `tenantIsolation.test.ts` |
| multi: 60 tareas concurrentes alternando dos tenants ven solo su pool | `tenantLegacyAccess.test.ts` |
| multi: 40 peticiones HTTP concurrentes alternando hosts ven solo su pool (middleware real) | `tenantLegacyAccess.test.ts` |
| LRU no cierra un pool arrendado; con todos arrendados se supera el máximo | `tenantLegacyAccess.test.ts` |
| La invalidación aplaza el cierre hasta liberar; sin arriendos cierra en el acto | `tenantLegacyAccess.test.ts` |
| El arriendo se libera al terminar la respuesta | `tenantLegacyAccess.test.ts` |
| Trabajo en segundo plano tras liberar sigue viendo SU tenant | `tenantLegacyAccess.test.ts` |
| Jobs: un tenant sin BD queda en error sin ejecutar la tarea | `tenantScheduler.test.ts` |
| Routers reales con dos empresas aprovisionadas, sin acceso cruzado | `server/tenantLegacyAccess.mysql.test.ts` |
| Ingesta IMAP con buzón global bloqueada en multi; intacta en single | `server/tenantImapIngestionGuard.test.ts` |

Prueba de sabotaje realizada: (1) volviendo a «lanzar siempre en multi» fallan 16 pruebas;
(2) con una implementación con fuga («devolver el último pool abierto, sin mirar el tenant»)
fallan 8, entre ellas las de concurrencia con routers reales (A llegó a ver `Proveedor B`). Las
pruebas secuenciales de un solo router no detectan esa fuga: la de concurrencia es imprescindible.

## Routers probados en multi con la aplicación real

Dos empresas aprovisionadas con la baseline (`db/baseline/0000_baseline.sql`), registro real,
autenticación local, `moduleRouteGuard`, `bindTenantMiddleware` real. Datos creados en A no se ven
en B y viceversa:

| Área | Procedimientos | Acceso heredado |
|---|---|---|
| CRM | `crm.clients.create`, `crm.clients.list` | `legacyDb` (`db.execute`, `select`) |
| Descuentos | `discounts.create`, `discounts.list`, `discounts.getById` | `legacyDb` |
| Proveedores | `suppliers.create`, `suppliers.list` (flag `suppliers_module_enabled`) | `legacyDb` |
| Numeración | `documentNumbers.updatePrefix`, `documentNumbers.getCounters` | `documentNumbers.ts` |
| Hotel | `hotel.adminCreateRoomType`, `hotel.adminGetRoomTypes`, `hotel.getRoomTypes` (licencia `hotel` + flag) | `hotelDb.ts`, `db/reviewsDb.ts` |
| Caja | `cashRegister.createAccount`, `cashRegister.listAccounts` (flag) | `legacyDb` + `legacyPool` |
| TPV | `tpv.getRegisters`, `tpv.openSession`, `tpv.getActiveSession` | `legacyDb` |
| Tareas internas | `withTenantDb` + `getAllCounters()` en paralelo para A y B | `documentNumbers.ts` |

Además: la cookie de A en el host de B no obtiene datos (≥401) y fuera de contexto
`getAllCounters()` lanza.

## Qué NO funciona todavía en multi (o no es seguro) y por qué

El acceso a la BD ya no es el bloqueo, pero eso **destapa** código que antes fallaba cerrado:

1. **Credenciales globales de entorno (riesgo de fuga, no solo de mal funcionamiento).**
   - Ingesta IMAP del TPV (`services/emailTpvIngestionService.ts`) y de gastos
     (`services/expenseEmailIngestionService.ts`): leen `IMAP_TPV_*`/`IMAP_EXPENSE_*` (un buzón).
     **Bloqueadas en multi** en esta rama (guarda explícita). También afecta a los
     disparadores manuales `emailIngestion.*` y `financial.emailIngestion.triggerSync`, que las invocan (devuelven vacío).
     Pendiente: credenciales IMAP por tenant en la bóveda (`integration_credentials`).
   - Correo saliente: `mailer.ts`/`emailManager.ts` usan `BREVO_API_KEY`/SMTP y
     `GLOBAL_CC_EMAIL` globales. No mezcla datos de BD, pero el remitente/copia es común a todas las
     empresas.
2. **Dominios y marcas fijos.** 21 de los 61 ficheros contienen «Náyade», `nayadeexperiences` o
   `skicenter.es` (asuntos de correo del TPV, PDFs de facturas, `gestoria*`, `sitemapRouter`,
   `redsysRoutes`, `hotel.ts` `SITE_URL`…). `process.env.APP_URL` aparece 22 veces en ellos:
   enlaces de pago, redirecciones de Redsys y URLs de correos apuntan al dominio global, no al de
   la empresa. Pendiente: sustituir por `_core/publicUrl.ts` / ajustes por tenant.
3. **DDL en tiempo de ejecución.**
   - `documentNumbers.ts` guarda `_tablesReady` a nivel de **proceso**: tras la primera empresa no
     se vuelve a comprobar para las demás. Inocuo hoy (ambas tablas están en la baseline), pero el
     patrón no es por tenant.
   - `crm.reservations.setInvoiceExempt` ejecuta `ALTER TABLE reservations ADD COLUMN` en cada
     llamada (falla y se ignora; la columna está en la baseline). En multi, el usuario de BD de la
     empresa necesitaría permiso DDL si la columna faltase.
   - `routes/ghlInboxRouter.ts` y `vapiWebhookRouter.ts` lanzan `CREATE TABLE IF NOT EXISTS` **al
     importar el módulo** (sin contexto): en multi lanza y se registra un aviso; las tablas
     existen en la baseline. `startCommercialEmailSyncJob` hace lo mismo al arrancar.
   Todas las tablas que el código heredado crea en tiempo de ejecución existen en la baseline
   (comprobado por script), así que nada de esto rompe hoy; es deuda.
4. **Ejecuciones «de arranque» fuera del planificador.** `startEmailIngestionJob`,
   `startExpenseEmailIngestionJob`, `startMatchingJob`, `startRelinkJob` y
   `startCommercialEmailSyncJob` lanzan una ejecución inicial con `setImmediate`/directa **fuera**
   de `runTenantJob`: en multi no hay contexto y lanza (capturado y registrado). Falla cerrado; las
   ejecuciones programadas sí funcionan por tenant.
5. **Handlers de cron «dispara y olvida».** `commercial-email-sync`, `expense-email-ingestion` y
   `cancellation-stale` no esperan a su promesa: el arriendo se libera antes de que acabe el
   trabajo, el bloqueo anti‑solapamiento del planificador no los cubre y todas las empresas corren
   en paralelo. El trabajo sigue viendo SU pool (probado), pero no está protegido de una
   expulsión: podría fallar con «pool cerrado», nunca leer de otra empresa.
6. **Webhooks externos** (`/api/redsys/*`, `/api/ghl/*`, `/api/vapi/*`): el tenant sale del `Host`.
   Funcionan solo si cada proveedor llama al dominio de la empresa; hoy las URLs se construyen con
   `APP_URL` global (punto 2).
7. **Módulos sectoriales**: hotel, spa y restaurantes requieren licencia en el registro y su flag
   `*_module_enabled` en la BD de la empresa. Spa y restaurantes no se han probado con routers
   reales en esta rama (mismo patrón que hotel).
8. **No probados con routers reales**: RRHH, gestoría, propuestas, partners, ticketing, bandejas de
   correo/GHL/Vapi, conciliación de datáfono, exportación de liquidaciones, sitemap. Usan el mismo
   Proxy, así que el acceso a BD queda resuelto por diseño, pero pueden tener los problemas de los
   puntos 1–6.

## Riesgos residuales

- **Estado de módulo no consciente del tenant** en los ficheros heredados (cachés, banderas
  `let x = …`). Revisado: `_tablesReady` (punto 3) y `isRunning` en servicios de jobs (que en
  multi se ejecutan en serie por tenant, así que no bloquean entre empresas salvo en los «dispara y
  olvida»). `routers/publicExpenses.ts` tiene un límite de tasa en memoria compartido entre
  empresas (no fuga datos). La configuración (`config/index.ts`) ya usa `TenantCache`.
- **Trabajo tras la respuesta**: conserva el arriendo del contexto en el `WeakMap` aunque ya se
  haya liberado; si el pool se invalida, las consultas fallan (nunca van a otra empresa).
- **Arriendo fallido**: la petición continúa sin arriendo; los errores del código heredado serán
  500 con `TenantResolutionError` en lugar de un 503 limpio.
- **Presión de pools**: con más de 50 empresas con peticiones simultáneas, se superan los 50 pools
  temporalmente (10 conexiones cada uno). Vigilar `max_connections` del servidor MySQL.
- Los alias `getSingleTenantDatabaseSync`/`getSingleTenantPoolSync` se mantienen por
  compatibilidad; ahora equivalen a `getCurrent*Sync` (en multi ya no lanzan siempre).

## Cómo ejecutar las pruebas

```bash
# Unitarias (sin BD)
pnpm exec vitest run server/tenantLegacyAccess.test.ts server/tenantImapIngestionGuard.test.ts \
  server/tenantScheduler server/legacyDb server/tenantIsolation

# Integración (MySQL desechable)
REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:3306/registry_test \
  pnpm exec vitest run server/tenantLegacyAccess.mysql.test.ts
```
