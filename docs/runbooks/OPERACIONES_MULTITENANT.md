# Runbook: operaciones del plano de control

Todas las órdenes salen de `scripts/tenants/cli.ts` (dry-run por defecto; `--apply` ejecuta) o de la API `/cp/v1`.

## Alta de un tenant
`provision <tenant> --name … --admin-email … --domain <dominioPlataforma> [--modules a,b]` → BD con usuario propio, baseline, administrador (invitación mostrada **una sola vez**), subdominio activo, licencias de prueba (15 días) y cuotas. Reejecutar es seguro (reanuda). `provision-status` muestra pasos; `provision-abort` (operador) elimina un alta que nunca se activó.

## Migraciones por tenant
`migrate-all` (dry-run) lista pendientes; `migrate-all --apply` aplica con **canario**: si el primer tenant falla no se toca ninguno más. Cada tenant actualiza su `schemaVersion` en el registro. Las migraciones siguen la convención de `db/migrations/README.md` (con `.down.sql` o marca de irreversibilidad).

## Copias de seguridad y restauración
- `backup <tenant> --out <dir>`: volcado lógico consistente (gzip) + manifiesto con filas y checksum por tabla.
- `backup-verify <manifest> --scratch-dsn-env VAR`: restaura en una BD **de pruebas** y compara filas/checksum. **Una copia solo es válida tras verificarse.**
- Frecuencia y retención: definir con el operador (pendiente de política); almacenar fuera del servidor de BD.
- Restauración real: crear BD vacía nueva, `restoreBackup`, comprobar, y cambiar la BD activa del tenant con `db-register` + `db-activate` (sin corte).

## Diagnóstico
`diagnose <tenant>`: estado, política de acceso, dominios, BD alcanzable, esquema, licencias, cuotas. Sin secretos. Código de salida ≠ 0 si algo falla.

## Licencias y cuotas
`entitlement-grant|status|revoke`, `quota-set|remove`, `usage <tenant>`.

## Reglas
- Ninguna orden imprime DSN ni claves. El DSN de una BD se pasa por variable de entorno.
- Toda escritura deja un evento inmutable en `tenant_events` con actor y motivo.
- Eliminaciones: solo `operator`, con motivo, y tras archivar.

## Conexiones MySQL: dimensionado y límites

La instancia MySQL de Railway la comparten el Core (un pool por empresa activa + pools fijos), el plano de
control y todas las bases de empresa. Cada conexión abierta cuenta contra `max_connections` (151 por defecto
en MySQL 8). Antes de este control, cada empresa abría hasta 10 conexiones sin límite global: con 10 empresas
se midieron 129 conexiones y con 20 empresas se agotó el servidor (`ER_CON_COUNT_ERROR`).

### Cómo funciona (modo `multi`)
- Cada empresa tiene su propio pool (nunca se comparte entre empresas) de `DB_TENANT_POOL_CONNECTIONS` conexiones.
- **Presupuesto por proceso** (`DB_TENANT_CONNECTION_BUDGET`): al crear el pool de una empresa se reserva su
  límite completo; la suma de reservas nunca supera el presupuesto, así que las conexiones abiertas tampoco.
- Sin hueco: se cierra el pool **menos usado recientemente que no tenga peticiones en curso** (LRU). Si todos
  están en uso, la petición espera hasta `DB_TENANT_BUDGET_WAIT_MS`; si sigue sin hueco responde
  **503 con `Retry-After`** (jobs: `DbCapacityError`, se reintentan en la siguiente pasada). Nunca se abre por encima.
- Conexiones ociosas: cada pool conserva como mucho `DB_TENANT_POOL_MAX_IDLE` y cierra las demás tras
  `DB_TENANT_POOL_IDLE_TIMEOUT_MS`. Los pools de empresas sin actividad durante `DB_TENANT_POOL_INACTIVE_MS`
  se cierran del todo (la siguiente petición lo vuelve a abrir).
- El modo `single` (instalación actual) no cambia: un pool de 10 conexiones (`DB_POOL_CONNECTIONS`), fuera del presupuesto.

| Variable | Defecto | Qué controla |
|---|---:|---|
| `DB_TENANT_POOL_CONNECTIONS` | 4 | Conexiones máximas por empresa (1–50) |
| `DB_TENANT_CONNECTION_BUDGET` | 60 | Suma máxima de conexiones de empresa por proceso del Core |
| `DB_TENANT_POOLS_MAX` | 50 | Pools vivos como máximo (el límite efectivo es el menor entre este y presupuesto ÷ conexiones: 15 por defecto) |
| `DB_TENANT_POOL_MAX_IDLE` | 1 | Conexiones ociosas que conserva cada pool |
| `DB_TENANT_POOL_IDLE_TIMEOUT_MS` | 30000 | Cierre de conexiones ociosas |
| `DB_TENANT_POOL_INACTIVE_MS` | 600000 | Cierre del pool de una empresa sin actividad (10 min) |
| `DB_TENANT_BUDGET_WAIT_MS` | 3000 | Espera máxima por hueco antes del 503 |
| `DB_TENANT_RETRY_AFTER_SECONDS` | 5 | Valor de `Retry-After` del 503 |
| `DB_REGISTRY_POOL_CONNECTIONS` | 5 | Pool fijo del registro en el Core |
| `DB_ERM_POOL_CONNECTIONS` | 3 | Pool fijo del ERM en el Core (si `ERM_DATABASE_URL`) |
| `CP_REGISTRY_POOL_CONNECTIONS` | 5 | Plano de control: registro |
| `CP_PROVISIONING_POOL_CONNECTIONS` | 2 | Plano de control: aprovisionamiento (usuario administrador) |
| `CP_ERM_POOL_CONNECTIONS` | 2 | Plano de control: consumo (ERM) |
| `CP_BILLING_POOL_CONNECTIONS` | 3 | Plano de control: facturación |
| `CP_CRM_POOL_CONNECTIONS` | 8 | Plano de control: un único pool para CRM, web, suscripciones, pruebas y pedidos (antes 5 pools, 17 conexiones) |
| `DB_FIXED_POOL_MAX_IDLE` / `DB_FIXED_POOL_IDLE_TIMEOUT_MS` | 2 / 60000 | Cierre de ociosas en todos los pools fijos |

Valores no numéricos se ignoran (se usa el defecto) y los fuera de rango se acotan: una variable mal escrita
nunca deja el proceso sin límite.

### Fórmula
```
conexiones_max = procesos_core × (DB_TENANT_CONNECTION_BUDGET + fijos_core)
               + fijos_plano_control
               + margen_operación
```
- `fijos_core` = registro (5) + ERM (3) = **8** (más 1–2 transitorias en migraciones/instalación de módulos).
- `fijos_plano_control` = 5 + 2 + 2 + 3 + 8 = **20** (antes 29).
- `margen_operación` ≈ **10–15**: consola de administración, copias (`backup`), migraciones manuales, sondas.

Con los valores por defecto:
- 1 proceso del Core: 1 × (60 + 8) + 20 + 15 = **103** → cabe en los 151 por defecto.
- 2 réplicas del Core: 2 × 68 + 20 + 15 = **171** → **requiere subir `max_connections`**.

### Recomendación para la instancia MySQL de Railway
- Fijar `max_connections` ≥ **1,25 × conexiones_max** (holgura para picos de reconexión): 151 basta para
  1 réplica con los valores por defecto; **250** para 2 réplicas; para N réplicas, `1,25 × (68·N + 35)`.
- Antes de añadir réplicas, recalcular con la fórmula y subir `max_connections` **primero**.
- Si hay muchas empresas activas a la vez y aparecen esperas o 503: subir `DB_TENANT_CONNECTION_BUDGET` (y
  `max_connections` según la fórmula) antes que `DB_TENANT_POOL_CONNECTIONS`. Medido con
  `server/rendimiento.perf.mysql.test.ts` (10 empresas, misma máquina): pico de conexiones 129 → 65; lecturas,
  altas, login y contratación sin cambios apreciables; escrituras con 10 peticiones simultáneas en UNA misma
  empresa (presupuestos/facturas) p95 +40–60 ms por la cola de 4 conexiones. Con 5 conexiones no se midió una
  mejora clara; si una empresa concreta lo necesitara, subir `DB_TENANT_POOL_CONNECTIONS` a 5.
- La memoria de MySQL crece con las conexiones (búferes por hilo): vigilarla al subir `max_connections`.

### Métricas y diagnóstico (sin identificadores de empresa ni DSN)
- Log estructurado `{"ctx":"DbPools","event":"stats",...}` cuando cambian esperas, rechazos o expulsiones:
  `pools`, `poolsLeased`, `connectionsOpen`, `connectionsInUse`, `connectionsReserved`, `connectionBudget`,
  `waiting` y acumulados (`waits`, `waitTimeouts`, `evictedLru`, `evictedIdle`, `peakReserved`).
- Log `{"ctx":"TenantBinding","event":"db_capacity_exhausted"}` por cada 503 por presupuesto agotado.
- Medición (ERM): `db.pool.wait.ms`, `db.pool.rejected`, `db.pool.evicted` (`reason: lru|idle`) por empresa.
- En el servidor: `SHOW STATUS LIKE 'Threads_connected'` y `SELECT USER, COUNT(*) FROM information_schema.PROCESSLIST GROUP BY USER`.
- Señales de alarma: `waitTimeouts` creciendo (presupuesto corto), `evictedLru` alto con pocas empresas
  (presupuesto o `DB_TENANT_POOLS_MAX` bajos), `Threads_connected` cerca de `max_connections`.
