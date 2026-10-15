# Fase 5 — Consolidación: inventario de PR, plan de integración, migraciones y riesgos

**Estado:** propuesta. Esta fase **no autoriza** fusiones, despliegues, migraciones productivas ni cobros. Todo lo que aquí se dice se ha comprobado contra GitHub y git el 15/10/2026. Los scripts de comprobación se describen en el anexo y se pueden repetir.

Bases: `main` del Core `baeca78`, del CRM `62183b1` y de la web `5aa098d`.

## 1. Inventario de PR abiertos

| Repo | PR | Rama → base | Tamaño | Riesgo | Toca |
|---|---|---|---|---|---|
| Core | #62 | `core/27-plans-catalog` → main | +40 | Medio | facturación (`getCatalog`, `GET /billing/plans`) |
| Core | #63 | `core/28-support-tickets` → main | +731 | Alto | **migración registro 0006**, arranque CP, scopes |
| Core | #64 | `core/29-legacy-credentials` → main | +698 | Alto | seguridad: cifrado de credenciales GHL en la **BD de la app** (script de datos) |
| Core | #65 | `core/30-startup-connections` → main | +151 | **Alto** | **arranque de la app de Náyade** (`server/_core/index.ts`) |
| Core | #66 | `core/31-registry-migrate` → main | +668 | Alto | ejecutor de migraciones del registro, `package.json` (scripts `build:cp`/`start:cp`) |
| Core | #67 | `feat/crm-commercial-v2` → main | +1406 | Medio | **migración CRM 0001**, CRM comercial |
| Core | #68 | `feat/crm-contracts-v2` → #67 | +580 | Medio | **migración CRM 0002**, contratos |
| Core | #69 | `feat/crm-dashboard` → #68 | +275 | Bajo | panel comercial |
| Core | #70 | `feat/crm-onboarding` → #69 | +425 | Alto | aprovisionamiento desde el CRM, arranque CP |
| Core | #71 | `feat/erm-resources` → main | +364 | Medio | ERM, arranque CP |
| Core | #72 | `feat/modules-catalog` → main | +493 | Medio | catálogo de módulos y licencias |
| Core | #73 | `fix/erm-quota-429` → main | +79 | Medio | **respuesta de la app** (tRPC 429) |
| Core | #74 | `docs/sesion-2026-10-15` → main | +81 | Bajo | documentación |
| Core | #75 | `feat/cp-operator-auth` → `integration/core-2026-10-15` | +2315 | **Alto** | **migración registro 0007**, autenticación, dependencia nativa `@node-rs/argon2` |
| Core | #76 | `feat/cp-web-leads` → #75 | +1268 | Alto | **migración CRM 0003**, API pública sin autenticación |
| Core | #77 | `feat/cp-web-catalog` → #76 | +2703 | Medio-alto | **migración CRM 0004**, scopes, lectura pública |
| CRM | #1–#4 | `crm-commercial-v2` → … → `crm-onboarding` (apilados) | +2332 | Medio | comercial, contratos, panel, alta |
| CRM | #5 | `erm-resources` → main | +472 | Bajo | vista de recursos |
| CRM | #6 | `modules-catalog` → main | +346 | Bajo | módulos y licencias |
| CRM | #7 | `elephant-enterprise-design-system` → `integration/crm-2026-10-15` | +4140 | Medio | rediseño, **`package.json`, CI** |
| CRM | #8 | `crm-operator-login` → #7 | +1131 | Alto | acceso por usuario y contraseña |
| CRM | #9 | `crm-web-requests` → #8 | +498 | Medio | solicitudes web |
| CRM | #10 | `crm-web-admin` → #9 | +1329 | Medio | administración de la web comercial |
| Web | #1 | `web-primera-entrega` → main | +12797 | Bajo | web nueva (no desplegada) |
| Web | #2 | `web-captacion` → #1 | +807 | Bajo | formularios → API pública |
| Web | #3 | `web-catalogo` → #2 | +1170 | Bajo | catálogo publicado |

**Estado real:**

- **Los 29 PR** son fusionables (`MERGEABLE/CLEAN`) y tienen la CI en verde. No hay borradores.
- **No hay commits compartidos** entre PR: ningún SHA aparece en dos PR.
- **Quedan atrás de `main` cuatro PR del Core** (#62, #63, #65 y #66), cada uno 2 commits (de documentación). No hay conflicto.

### Ramas de integración (no son PR)

| Rama | Contiene | Por delante de `main` |
|---|---|---|
| `integration/core-2026-10-15` | #62–#73 | 18 commits |
| `integration/crm-2026-10-15` | CRM #1–#6 | 7 commits |

Los PR #75 (Core) y #7 (CRM) apuntan a ellas: no llegan a `main` hasta que lo haga todo lo que contienen.

**Verificación:**

- Fusionar los PR individuales en orden sobre `main` produce un árbol **idéntico byte a byte** al de cada rama de integración, y el de la cadena completa al de la punta (`feat/cp-web-catalog` y `feat/crm-web-admin`).
- **Las ramas de integración no esconden resoluciones de conflictos.**

## 2. Grafo de dependencias

Las flechas indican «necesita»: base del PR y contención real con `git merge-base --is-ancestor`.

```
CORE  (main baeca78)
  #74 docs ─────────────────────────────────────────────────────────────┐ (independiente)
  #62 plans ┐                                                            │
  #72 modules ├─(independientes entre sí, base main)                      │
  #73 fix429  │                                                          │
  #71 erm     │                                                          │
  #63 tickets │                                                          │
  #64 legacy  │                                                          │
  #65 startup │                                                          │
  #66 regmig ─┘                                                          │
  #67 crm-v2 ◄─ #68 contracts ◄─ #69 dashboard ◄─ #70 onboarding          │
        └──────────── todos ───────────► integration/core-2026-10-15      │
                                               ▲                         │
                                       #75 operator-auth ◄─ #76 web-leads ◄─ #77 web-catalog

CRM  (main 62183b1)
  #1 commercial ◄─ #2 contracts ◄─ #3 dashboard ◄─ #4 onboarding ┐
  #5 erm ────────────────────────────────────────────────────────┼─► integration/crm-2026-10-15
  #6 modules ────────────────────────────────────────────────────┘          ▲
                                              #7 design-system ◄─ #8 operator-login ◄─ #9 web-requests ◄─ #10 web-admin

WEB  (main 5aa098d)
  #1 primera-entrega ◄─ #2 captación ◄─ #3 catálogo

ENTRE REPOS (en ejecución, no en git)
  CRM #8  necesita Core #75 (login de operadores)
  CRM #9  necesita Core #76 (+ migración CRM 0003)      Web #2 necesita Core #76 (API pública)
  CRM #10 necesita Core #77 (+ migración CRM 0004)      Web #3 necesita Core #77 (/public/site)
  CRM #1–#4 necesitan Core #67–#70 (+ migraciones CRM 0001–0002)
```

## 3. Qué afecta a producción (Railway)

Railway despliega desde `main` **solo la app del tenant (Náyade)**:

- `railway.toml`: `buildCommand = "npm run build"` y `startCommand = "npm run start"`.
- `package.json`: compila y arranca `server/_core/index.ts`.

El plano de control (`server/controlPlane/main.ts`) **no está desplegado en ningún sitio**. El runbook lo dice: «preparado, NO desplegado»; bloqueo B12.

**Consecuencias:**

- **Cada fusión en `main` redespliega la app de Náyade**, aunque el cambio sea solo del plano de control. Hay que verificar el arranque tras cada una (CLAUDE.md: «un cambio = un commit = un deploy verificado»).
- **Afectan directamente a la app en producción:**
  - **#65:** cambia el arranque.
  - **#73:** cambia la respuesta de tRPC ante una cuota superada.
  - **#64:** el código lee los campos cifrados; el script, ejecutado por separado, los cifra.
  - **#75:** añade una dependencia nativa (`@node-rs/argon2`) que Railway instalará en cada build.
  - **#66:** añade scripts a `package.json`, sin cambiar `build` ni `start`.
- **El resto es código del plano de control:**
  - Se compila en el bundle de la app solo si `server/_core/index.ts` lo importa, y hoy no lo hace.
  - Las migraciones del registro y del CRM afectan a BD que **no existen todavía en producción**.

**Problema ya presente en `main` (no lo introduce ningún PR):**

- La app **migra y aplica DDL en cada arranque**: `runMigrations()` de drizzle y una docena de `ensure*Columns`.
- Además se traga el error (`server/_core/index.ts:264-282` y `:1931-1945`).
- Contradice CLAUDE.md («Migraciones y schema — nunca en startup»).
- Debe retirarse en un PR propio. Ver la decisión D2.

## 4. Plan de integración por bloques

**Regla común a todos los bloques:**

- Un PR cada vez, en el orden indicado.
- Antes de fusionar: CI en verde.
- Después: esperar el deploy de Railway y comprobar el log (`Server running on http://localhost:3000/` y los jobs sin errores) antes del siguiente.
- Ningún PR se fusiona automáticamente.

**Orden verificado:** el orden de abajo se ha simulado de punta a punta sobre `main`. No da conflictos y produce exactamente el mismo árbol final que el orden de las ramas de integración (`60f27be`).

### Bloque 1 · Bajo — documentación e interfaz sin efecto en producción

| PR incluidos | Core #74; Web #1 → #2 → #3 (la web no tiene alojamiento; fusionarla no despliega nada) |
|---|---|
| **Dependencias** | Ninguna. La web funciona degradada (sin captación ni catálogo) mientras el Core no despliegue #76/#77. |
| **Pruebas previas** | CI verde. En la web: `astro check`, Vitest y Playwright. |
| **Validación posterior** | Railway arranca limpio tras #74 (solo documentación, pero redespliega). |
| **Condición de parada** | Cualquier error de arranque en Railway. |
| **Recuperación** | `git revert` del merge. |

### Bloque 2 · Medio — catálogo, licencias, ERM y CRM comercial (solo plano de control)

| PR incluidos | Core #62, #72, #73, #71, después la cadena #67 → #68 → #69 → #70. CRM #1 → #2 → #3 → #4, #5, #6. |
|---|---|
| **Dependencias** | CRM #1–#4 necesitan Core #67–#70 **desplegado** con las migraciones CRM 0001 y 0002. Hasta que el CP exista en producción, fusionar es inocuo. |
| **Pruebas previas** | CI. Suite `crm.mysql.test.ts` contra MySQL desechable. `verify --dir db/crm/migrations`. Para #73: probar en local la app con cuota superada (429). |
| **Validación posterior** | Tras #73: el arranque de Railway y una petición tRPC normal. El resto no cambia la app. |
| **Condición de parada** | Error de arranque o cualquier 5xx nuevo en la app tras #73. |
| **Recuperación** | `git revert` del merge. Las migraciones CRM 0001/0002 **no se aplican** en este bloque. |

Hay que redirigir la base de #68, #69 y #70 a `main` según se fusiona su predecesor; GitHub lo hace al borrar la rama, pero **no borrar ramas sin confirmación** (CLAUDE.md).

### Bloque 3 · Alto — arranque, seguridad, registro y aprovisionamiento

Un PR por despliegue, en este orden:

| Orden | PR | Prerrequisito | Validación posterior | Parada | Recuperación |
|---|---|---|---|---|---|
| 3a | Core #63 (tickets, registro 0006) | — | Arranque de Railway | Error de arranque | Revert (la migración no se aplica aquí) |
| 3b | Core #64 (credenciales heredadas, **solo código**) | El código lee valores en claro y cifrados | La app lee las credenciales GHL y el inbox funciona | Fallo de GHL o del inbox | Revert. **El script de cifrado NO se ejecuta en este bloque** (decisión D4) |
| 3c | Core #65 (conexiones de arranque) | Probar en local el arranque normal y con la BD caída | Railway arranca y libera las conexiones (sin fugas en MySQL) | Arranque más lento, conexiones abiertas o fallo | Revert inmediato |
| 3d | Core #66 (ejecutor del registro) | **Antes**, PR aparte: `GET_LOCK`, confirmación de BD y separación de variables (riesgo M2) | Railway arranca (solo scripts nuevos) | — | Revert |
| 3e | Core #75 (operadores, registro 0007, argon2) | Redirigir a `main` una vez la integración esté dentro; build de Railway con argon2 en Linux | **Railway compila** (dependencia nativa) y arranca | Fallo de build o de arranque | Revert del merge. El lockfile vuelve con él |
| 3f | CRM #7 → #8 | Core #75 en `main` | El CRM compila | — | Revert |

### Bloque 4 · Medio-alto — APIs comerciales públicas

| PR incluidos | Core #76 → #77; CRM #9 → #10 |
|---|---|
| **Dependencias** | Bloque 3. Para funcionar en producción: CP desplegado (B12), migraciones CRM 0003/0004 y variables `CP_PUBLIC_*`. |
| **Pruebas previas** | Suites `controlPlane.publicIntake` y `controlPlane.webCatalog`, sus MySQL y la E2E de punta a punta en local. **Corregir antes la aprobación no atómica de precios de #77 (riesgo F17).** |
| **Validación posterior** | Railway arranca (la app no usa este código). |
| **Condición de parada** | Error de arranque. |
| **Recuperación** | Revert. Sin CP desplegado, las APIs no existen en producción. |

### Bloque 5 · Alto — puesta en marcha del plano de control (fuera de esta fase)

No se fusiona nada nuevo. Es la operación de despliegue, que requiere autorización:

1. Alojamiento del CP (B12).
2. BD del registro con las migraciones 0006 y 0007.
3. BD del CRM con `0000` y 0001–0004.
4. Variables.
5. Primer operador.
6. Facturación **apagada**.

## 5. Matriz de migraciones pendientes

Solo hay migraciones pendientes en el registro y en el CRM. **Ninguna toca la BD de la app de Náyade**: billing, ERM, `db/migrations`, baseline y drizzle no tienen cambios pendientes. Los blobs son idénticos en todas las ramas que los contienen.

| Migración | PR | BD | Qué hace | Re-ejecutable | Compatible con `main` | Privilegios | Si falla a mitad | Reversión | Backup |
|---|---|---|---|---|---|---|---|---|---|
| `registry/0006_support_tickets` | #63 | Registro | 2 `CREATE TABLE IF NOT EXISTS` (FK CASCADE en eventos) y marcador 0006 | Sí | Aditiva | CREATE, INDEX, REFERENCES, UPDATE | Tablas creadas; se reanuda sin problema | Sin `.down` (DROP manual) | Recomendado |
| `registry/0007_operators` | #75 | Registro | 4 tablas (operadores, sesiones, restablecimientos, eventos) y marcador 0007 | Sí | Aditiva; el CP desactiva el login si falta | Igual | Igual | Sin `.down` | Recomendado |
| `crm/0001_crm_commercial_v2` | #67 | CRM | 4 `ALTER`: columnas, columna generada STORED, `UNIQUE`, ENUM de etapas ampliado en medio (copia de tabla) | **No** | Aditiva (todo NOT NULL lleva DEFAULT) | ALTER, INDEX | **Estado intermedio**: cada ALTER es atómico, el fichero no queda registrado y hay que arreglarlo a mano | `.down` **pierde datos**: reasigna etapas a `prospecting` y elimina columnas | **Obligatorio** |
| `crm/0002_crm_contracts_v2` | #68 | CRM | `ALTER` con 11 columnas y `UNIQUE`, **relleno** `reference = CT-NNNNNN`, tabla de versiones | **No** | Aditiva | ALTER, INDEX, UPDATE, CREATE, REFERENCES | Estado intermedio | `.down` pierde historial y referencias | **Obligatorio** |
| `crm/0003_crm_web_requests` | #76 | CRM | 1 `CREATE TABLE` (FK, 2 `UNIQUE`) | No (una sola sentencia atómica) | Aditiva | CREATE, INDEX, REFERENCES | No aplica | `.down` pierde las solicitudes | Recomendado |
| `crm/0004_web_catalog` | #77 | CRM | 4 `CREATE TABLE` (FK, CHECK ≥ 0 desde MySQL 8.0.16) | No | Aditiva; el CP la sondea | CREATE, INDEX, REFERENCES | Tablas sueltas: DROP manual y reintento | `.down` pierde el catálogo | Recomendado |
| Script `legacy-credentials` | #64 | **App** | Cifra 4 claves GHL en `system_settings`/`site_settings`; crea `legacy_credential_audit` **fuera de los carriles** | Sí (fila a fila, compara el valor leído) | **Solo con el código de #64 desplegado** | UPDATE, CREATE | Fila a fila | `rollback` del script | **Obligatorio** (`--backup-confirmed`) |

**Orden de ejecución, cuando se autorice:**

- **Registro:**
  1. Backup con `mysqldump --single-transaction --routines --triggers`.
  2. `registry-migrate` en simulación.
  3. `--execute` en una única sesión, con un usuario que tenga CREATE, ALTER, INDEX, REFERENCES y TRIGGER.
  4. Comprobar el marcador en 0007.
- **CRM:**
  1. `0000` a mano si la BD no existe.
  2. Backup.
  3. `verify`, `status`, `up` en simulación y `up --apply --confirm-database <crm>`, **siempre con `--dir db/crm/migrations`**, paso a paso con `--to`.
  4. **Antes de 0002**, decidir el formato de la referencia (D5).

**Problemas de los ejecutores (corregir antes de producción):**

| Id | Problema | Corrección propuesta |
|---|---|---|
| M1 | La app migra en el arranque (`main`). | Retirar `runMigrations` y los `ensure*` del arranque y llevarlos al ejecutor `db/migrations` (PR aislado; D2). |
| M2 | `registry-migrate` no tiene `GET_LOCK` ni confirmación de BD, y usa `REGISTRY_ADMIN_DATABASE_URL`, la misma variable que el CP en ejecución. Si cree que la 0000 está «incompleta» (por ejemplo, sin privilegio TRIGGER), reaplica en cascada y recrea los triggers de auditoría. | Bloqueo, `--confirm-database`, variable propia (`REGISTRY_MIGRATE_URL`) y no reaplicar en cascada sin `--repair` explícito. |
| M3 | `scripts/db/migrate.ts` usa `db/migrations` como directorio por defecto. Si se olvida `--dir` con la URL del CRM, contamina el libro de la BD equivocada. Un túnel por `127.0.0.1` se salta la confirmación. | Que el ejecutor compruebe que el libro y el directorio corresponden a la misma BD, y exigir `--confirm-database` siempre fuera de CI. |
| M4 | El CI no verifica `db/crm/migrations`. | Añadir `verify --dir db/crm/migrations` al workflow. |
| M5 | Las migraciones del CRM no son re-ejecutables y el ejecutor registra por fichero. | Documentar el procedimiento de reparación y probar cada una en una copia restaurada de producción antes de aplicarla. |
| M6 | Relleno de 0002 con formato `CT-000001` frente al `CT-AAAA-NNNNNN` del código y del README. | D5. |
| M7 | `legacy_credential_audit` es DDL fuera de cualquier carril. | Moverla a `db/migrations` antes de ejecutar el script. |

## 6. Riesgos para producción

| Riesgo | Dónde | Severidad | Mitigación |
|---|---|---|---|
| Cualquier fusión en `main` redespliega Náyade | Railway | Media | Un PR por deploy verificado |
| Arranque de Náyade cambiado (#65) | `server/_core/index.ts` | Alta | Aislado, probado en local, revert inmediato |
| Dependencia nativa nueva en el build (#75) | `package.json`, lockfile | Media | Comprobar el build de Railway; revert |
| Credenciales GHL cifradas con el código viejo | Script de #64 | **Alta** | Desplegar el código antes; script solo con autorización y backup |
| DDL en el arranque de la app (ya existe) | `main` | Alta | M1 / D2 |
| Ejecutor del registro sin bloqueo ni confirmación | #66 | Alta | M2 antes de usarlo |
| Migraciones del CRM no re-ejecutables | #67/#68/#76/#77 | Media | Backup, `--to` paso a paso, ensayo en copia |
| Motor de facturación con riesgo de doble cobro | `server/_core/billing` (ya en `main`, apagado) | **Crítica si se enciende** | No activar cobros ni programar `tick` hasta el nuevo modelo (`docs/architecture/SUSCRIPCIONES_PRECIOS_CONTRATADOS.md`) |
| Aprobación de precios no atómica (#77) | `server/web/service.ts` | Media | Corregir antes de fusionar #77 |
| Licencias perpetuas concedidas a mano | `PUT /tenants/:id/entitlements` y CLI | Media | Exigir `validUntil` o un motivo auditado |

## 7. Decisiones que requieren autorización

| Id | Decisión |
|---|---|
| D1 | Empezar el Bloque 1 (fusionar #74 y la web) y el orden propuesto. |
| D2 | Abrir el PR que retira las migraciones del arranque de la app (M1). Es un cambio de arranque de Náyade, aislado y con su propio deploy verificado. |
| D3 | Corregir los ejecutores (M2, M3, M4 y M7) en PR propios **antes** del Bloque 3. |
| D4 | Si, cuándo y con qué backup se ejecuta el cifrado de credenciales heredadas en la BD de Náyade. |
| D5 | Formato de referencia de los contratos existentes: `CT-NNNNNN` (relleno actual) o `CT-AAAA-NNNNNN` (código). |
| D6 | Corregir la aprobación atómica de precios en #77 antes de fusionarlo. |
| D7 | Alojamiento y puesta en marcha del plano de control (B12), siempre con la facturación **apagada**. |
| D8 | Aprobar el diseño de precios contratados y su plan de transición (documento de arquitectura) antes de tocar el motor de facturación. |
| D9 | Si el CRM y la web tienen despliegue propio (no consta en los repositorios); confirmar antes de fusionar en sus `main`. |

## Anexo: cómo se ha comprobado

- **Inventario:** `gh pr list --json …` en cada repo, más `git rev-list` y `git diff --name-only base...head` por PR, con clasificación de archivos sensibles: migraciones, arranque e infraestructura, seguridad, facturación y aprovisionamiento.
- **Contención:** `git merge-base --is-ancestor` entre las cabezas de todos los PR y de las ramas de integración.
- **Conflictos y equivalencia:** fusión real `--no-ff` sobre `origin/main` en worktrees desechables, comparando el *tree* final con las ramas de integración y con las puntas. No se empuja nada.
- **Migraciones y facturación:** lectura del código en `origin/main` y en `feat/cp-web-catalog`, con verificación directa de los puntos críticos (`server/_core/index.ts:264-282, 1931-1945`, `db/crm/migrations/0002…:21`, `server/_core/billing/service.ts:361`; `tick()` sin llamadores fuera de los tests).
