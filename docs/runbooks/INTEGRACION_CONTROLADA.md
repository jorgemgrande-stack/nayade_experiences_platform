# Runbook único: integración controlada de Big Elephant

**Estado:** preparado, **no ejecutado**. Ninguna fusión ni despliegue se hace sin autorización expresa de Jorge, paso a paso.

**Fuentes:**
- `docs/roadmap/FASE5_INTEGRACION.md` (§4, §8 y §9);
- `docs/runbooks/MANTENIMIENTO_ESQUEMA.md` (#79);
- verificación del 16/10/2026 (ver §8).

## 1. Hechos que condicionan todo

| Hecho | Consecuencia |
|---|---|
| **Cada push a `main` del Core despliega Náyade en producción** (Railway: proyecto «Nayade Experiences», servicio `nayade_experiences_platform`), unos 4 segundos después y sin esperar al CI. También lo hacen los cambios de solo documentación. | Cada PR del Core que se fusiona es un despliegue: **uno a uno, verificando cada uno**. |
| Hasta que se despliegue #79, **cada arranque de Náyade ejecuta migraciones de drizzle y DDL** (`ensure*`, GHL, VAPI). | #79 va **primero** entre los PR de código del Core. |
| La web y el CRM no tienen despliegue configurado (sin GitHub Deployments, sin servicio en Railway). | Fusionar en sus `main` no cambia nada en producción. |
| **Ningún PR abierto añade migraciones de drizzle** a la BD de Náyade. Sus migraciones son del registro (`db/registry`) y del CRM (`db/crm/migrations`), bases que **no existen en producción**, salvo `db/migrations/0002` (#82). | Integrar el Core **no exige migrar la BD de Náyade**. Cada migración del plano de control se aplicará cuando se ponga en marcha (B12), con su propio procedimiento. |
| El plano de control (`/cp/v1`) **no está desplegado**. | El código del plano de control que entra en `main` no se ejecuta en producción. Sí forma parte del repositorio que Railway instala y compila. |

## 2. Orden exacto

**Leyenda:**
- **D** = despliegue de Náyade.
- **Migr. Náyade** = migración que habría que aplicar en la BD de Náyade.
- **Migr. CP** = migraciones de bases del plano de control (no existen en producción; no se aplican al fusionar).

### Paso 0 · Bloque 1: web (sin despliegue)

| # | PR | Acción | D | Migr. Náyade | Pruebas exigidas |
|---|---|---|---|---|---|
| 0.1 | Web #1 `feat/web-primera-entrega` → `main` | fusionar con *merge commit* | no | no | CI de la web en verde (tipos, veracidad, E2E) |
| 0.2 | Web #2 | `gh pr edit 2 --base main`, esperar al CI y fusionar | no | no | idem |
| 0.3 | Web #3 | `gh pr edit 3 --base main`, esperar al CI y fusionar | no | no | idem; `pnpm build` local con `CATALOG_REQUIRED=0` |

Verificado el 16/10: #1 → #2 → #3 sobre `main` no tiene conflictos y el árbol final es idéntico a la punta de #3.

**Comandos** (con autorización):
```bash
cd bigelephant-web
gh pr merge 1 --merge
gh pr edit 2 --base main && gh pr checks 2 --watch && gh pr merge 2 --merge
gh pr edit 3 --base main && gh pr checks 3 --watch && gh pr merge 3 --merge
```

### Paso 1 · Plan de esquema de solo lectura en producción (antes de cualquier fusión del Core)

Script de #83. Ejecutarlo requiere una clave SSH **propia** registrada en Railway, o que Jorge lo ejecute.

**El resultado decide:**
- **Esquema al día:** se continúa.
- **Hay migraciones pendientes o faltan objetos:** se analiza antes de seguir. Con #79, dejarán de aplicarse solas al arrancar.

### Paso 2 · Core, un PR por despliegue

Cada fila es **una fusión y un despliegue verificado** (§3). Los PR apilados se cambian de base a `main` cuando su base ya está fusionada.

| # | PR | Riesgo | Cambia arranque/build | Migr. CP | Migr. Náyade |
|---|---|---|---|---|---|
| 2.1 | **#79** arranque sin DDL | alto | **sí** (`index.ts`) | — | no; el arranque solo comprueba |
| 2.2 | #85 DDL bajo demanda → mantenimiento | medio | sí (`index.ts`) | — | no |
| 2.3 | #83 plan de solo lectura (herramienta) | bajo | no | — | no |
| 2.4 | #74 documentación | bajo | no | — | no |
| 2.5 | #78 documentación | bajo | no | — | no |
| 2.6 | #62 catálogo de planes | bajo | no | — | no |
| 2.7 | #72 catálogo de módulos | bajo | no | — | no |
| 2.8 | #73 ERM 429 en tRPC | medio | código que se ejecuta en Náyade | — | no |
| 2.9 | #71 recursos ERM | medio | `controlPlane/main.ts` | — | no |
| 2.10 | #67 CRM comercial v2 | medio | no | CRM 0001 | no |
| 2.11 | #68 contratos v2 (con D5) | medio | no | CRM 0002 | no |
| 2.12 | #69 panel CRM | bajo | no | — | no |
| 2.13 | #70 onboarding | medio | `controlPlane/main.ts` | — | no |
| 2.14 | #80 ejecutor de migraciones y CI | medio | no (CI) | — | no |
| 2.15 | #84 triggers de tenants nuevos | medio | no | — | no |
| 2.16 | #63 tickets de soporte | alto | `controlPlane/main.ts` | registro 0006 | no |
| 2.17 | #64 credenciales heredadas (código) | alto | código de Náyade (lectores compatibles) | — | no; el script **no** se ejecuta (D4) |
| 2.18 | #82 auditoría del cifrado | medio | no | — | `db/migrations/0002` **solo** si se aprueba D4 |
| 2.19 | #65 conexiones de arranque | alto | **sí** (`index.ts`) | — | no |
| 2.20 | #66 migrador del registro y `build:cp` | alto | `package.json` (scripts) | — | no |
| 2.21 | #81 seguridad del migrador del registro | medio | no | — | no |
| 2.22 | #75 operadores y Argon2 | alto | `package.json` + `pnpm-lock` (**dependencia nativa `@node-rs/argon2`**) | registro 0007 | no |
| 2.23 | #76 captación web | medio-alto | `controlPlane/main.ts` | CRM 0003 | no |
| 2.24 | #77 catálogo comercial | medio-alto | `controlPlane/main.ts` | CRM 0004 y 0005 | no |

**Base de #75:** `integration/core-2026-10-15`, una rama que no es un PR. Cuando estén fusionados #62–#73, se cambia su base a `main`. El 16/10 se simuló la secuencia completa (24 ramas) sin conflictos; el árbol resultante solo difiere de la punta de #77 en los ficheros de las correcciones de las fases 5.1 y 5.2.

### Paso 3 · CRM (sin despliegue)

CRM #1 → #2 → #3 → #4, #5, #6, #7 (base `integration/crm-2026-10-15`; cambiar a `main`), #8, #9 y #10. Simulado el 16/10: sin conflictos y con el árbol final idéntico a la punta de #10.

## 3. Qué comprobar en cada despliegue del Core

1. **Antes de fusionar:**
   - el CI del PR está en verde: «Suites del Core multiempresa (bloqueante)»;
   - `git diff` solo contiene lo descrito;
   - nadie más ha fusionado nada desde el último despliegue verificado.
2. **Fusionar:** con *merge commit*. #79 con *squash*, para que sea un único commit.
3. **Railway:**
   - el despliegue nuevo aparece con el SHA de la fusión;
   - la construcción termina;
   - el estado pasa a `SUCCESS`;
   - el anterior queda `REMOVED`.

   `railway deployment list -p "Nayade Experiences" -e production -s nayade_experiences_platform --limit 3` (solo lectura).
4. **Logs del contenedor:**
   - `Server running on http://localhost:3000/`;
   - los jobs registrados sin errores;
   - desde 2.1, `[Schema] ✓ Esquema al día`;
   - ningún `[Schema] ✗` ni errores nuevos.
5. **Comprobaciones externas:**
   - `GET /healthz` → 200;
   - `GET /readyz` → 200;
   - la portada de `www.nayadeexperiences.es` carga;
   - flujo crítico, solo en modo lectura: listado de reservas en el panel. No crear reservas reales.
6. **Si todo está bien**, se anota el SHA activo y se pasa al siguiente paso. Si no, §4.

## 4. Qué hacer si falla un despliegue

**Regla de CLAUDE.md:** no se encadenan correcciones. Primero se recupera y después se diagnostica en local.

| Síntoma | Acción inmediata |
|---|---|
| La construcción falla (Railway marca `FAILED`) | Railway mantiene el despliegue anterior activo: **no hay caída**. Se revierte la fusión en `main` (`git revert -m 1 <merge>` en una rama y PR) para que `main` vuelva a coincidir con lo activo. Diagnóstico en local. |
| El contenedor arranca y se cae, o hay errores al arrancar | **Rollback en Railway** al despliegue anterior: botón *Rollback* del despliegue `REMOVED` previo. Requiere autorización; es lo más rápido. Después, `git revert` de la fusión para alinear `main`. |
| La app arranca pero un flujo falla | Valorar el impacto. Si afecta a reservas, pagos o facturas: rollback inmediato. Si no, `git revert` y redespliegue. |

## 5. Volver al estado anterior: por capa

`git revert` **solo** recupera el código. No basta cuando una migración o un script han cambiado el esquema o los datos.

| Capa | Qué cambia en esta integración | Cómo se recupera |
|---|---|---|
| **Código** | Todos los pasos | `git revert -m 1 <merge>`, que despliega de nuevo el estado anterior, o el *Rollback* de Railway al despliegue previo. |
| **Esquema de Náyade** | **Nada al fusionar.** Desde #79 el arranque no modifica el esquema. Solo cambiaría con el mantenimiento explícito (`--schema-maintenance --apply`) o con `db/migrations` (#82, D4), y ambos requieren autorización aparte. | Antes de cualquier cambio de esquema: **copia de seguridad verificada**. El mantenimiento es aditivo (`IF NOT EXISTS`, `ADD COLUMN` si falta). Para revertir una columna o tabla añadida: `down` de `db/migrations` si existe, o eliminación manual revisada. Si hay datos ya escritos en ella, se restaura la copia. |
| **Esquema del plano de control** (registro, CRM) | Nada en producción: esas bases no existen. | Cuando existan: `scripts/db/migrate.ts down --dir … --apply --confirm-database …` (reversiones probadas para CRM 0001–0005) o restaurar la copia. |
| **Datos de Náyade** | **Nada** al fusionar. **Cuidado al revertir #79**: si se vuelve al arranque antiguo, el siguiente arranque ejecuta otra vez las correcciones de datos de `ensureCriticalSeeds` (teléfonos, plantillas, cupones). Ya existían y son idempotentes, pero escriben. | Copia de seguridad o PITR de la BD de Railway. El script de credenciales (#64/#82), si llega a ejecutarse, tiene su propio `rollback --execute` y requiere la copia previa. |
| **Configuración (Railway: variables, servicio)** | **Nada**: ningún paso cambia variables ni configuración. `SCHEMA_CHECK` es opcional y por defecto vale `warn`. | Antes de cualquier cambio futuro: exportar la configuración y anotar el valor anterior de cada variable. Recuperar = restaurar ese valor y redesplegar. |

## 6. Bloqueado (requiere autorización)

- **Fusiones:** todas las de este runbook.
- **Plan de esquema en producción** (paso 1): requiere una clave SSH propia.
- **Rollback en Railway** desde el panel o la CLI.
- **Railway:** desactivar el despliegue automático, configurar *watch paths* o activar «esperar al CI». Ver la propuesta en `docs/infra/ARQUITECTURA_LANZAMIENTO.md`.

## 7. Comprobaciones posteriores a la integración completa

- **Simulación previa en local:** sobre `main` con los 24 PR del Core pasan las suites bloqueantes (574 pruebas unitarias en la lista del CI y 72 con MySQL).
- **Arranque real** con la baseline de producción: `[Schema] ✓` y la app arranca.
- **Mantenimiento:** 15 pasos idempotentes.
- **Después de cada paso real:** §3.

## 8. Verificación del 16/10/2026 (local, sin tocar producción)

- **Inventario** de los 37 PR abiertos (24 del Core, 10 del CRM y 3 de la web): CI en verde y sin commits compartidos.
- **Core:** secuencia completa de 24 ramas sin conflictos. Árbol integrado `80dbc0d`. Sus diferencias con la punta de #77 son **exactamente** los ficheros de #74, #78–#85 y D5. Suites bloqueantes en verde.
- **CRM:** 10 ramas sin conflictos; árbol final idéntico a la punta de #10.
- **Web:** 3 ramas sin conflictos; árbol final idéntico a la punta de #3.
- **Suite completa de Vitest** (sin MySQL), sobre `main` y sobre la integración: **los mismos 4 ficheros y 18 pruebas fallan en ambos**. Son fallos preexistentes; el CI los trata como informativos. La integración añade 190 pruebas, todas en verde: **sin regresiones**.
