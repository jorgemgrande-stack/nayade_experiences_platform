# Estado de ejecución

> Fuente de verdad para reanudar en otra sesión. Se actualiza al cerrar cada bloque.

**Producción:** `TENANT_MODE=single`. Último despliegue verificado: `main` @ #34 (sondas `/healthz`, `/readyz`, `/kb.json`, `/api/redsys/health` 200; `/api/ghl/templates` 401; 0 errores en logs).

## Worktrees (Window 2)
`C:\Users\jgran\Documents\nayade_worktrees\{core-saas,core-int,core-pools,core-work}` — ramas `core/*` y `docs/*`. Window 1: `prod-features`.
node_modules: junction hacia `core-saas\node_modules`.

## Flujo de integración
PR pequeño → CI (informativo) + ratchet → `gh pr merge --merge` → esperar despliegue Railway (`railway deployment list --json`, desde el repo principal) → sondas → revisar logs.
Scripts de cola reutilizables en el scratchpad de la sesión (`queue2.sh`/`queue3.sh`): `finish <PR>`.

## Completado en main
- Fase 01A completa; CI informativo; baseline BD (`db/baseline`), runner de migraciones, ratchet.
- Pools consolidados en `dbRegistry`/`legacyDb` (resta `_core/index.ts`).
- Registro de tenants: contrato, ciclo de vida, cifrado AES-256-GCM, servicio, resolutor, sombra, almacén MySQL, middleware, `tid`, jobs, CLI, pruebas de aislamiento (memoria + MySQL real).
- Runbook `docs/runbooks/ACTIVACION_MULTITENANT.md`.

## En curso
- `core/03-caches`: cachés de config/flags y emisor SSE por tenant (`server/_core/tenantScope.ts`).

## Cola (siguiente, en orden)
1. Almacenamiento por tenant (prefijos, control de acceso, compatibilidad con ficheros heredados).
2. Cron/procesos internos en `runForEachTenant` (+ lock, idempotencia, registro de resultados).
3. Arranque: retirar `runMigrations`/DDL de `_core/index.ts`; migraciones fuera del arranque.
4. Pruebas multi-tenant ampliadas (usuarios, pedidos, reservas, archivos, permisos, caída del registro).
5. Fase 03 módulos/licencias → 04 ERM → 05 aprovisionamiento → 06 → 07 → 08 → 09.

## Deuda conocida
- tsc: 118 errores preexistentes (línea base). Tests: ~18 fallos preexistentes (13 requieren BD real).
- `server/_core/vite.ts` inyecta SEO fijo de Náyade (resolver en Fase 07).
