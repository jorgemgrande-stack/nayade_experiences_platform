# Mantenimiento de esquema de Náyade (fuera del arranque)

Desde este cambio, **el arranque de Náyade ya no modifica el esquema**. Antes, cada arranque ejecutaba las migraciones de
drizzle (tragando el error), una decena de pasos `ensure*` con `CREATE`/`ALTER` (incluido un `DROP TABLE partners`
condicional), semillas críticas y la creación de tablas de GHL Inbox y VAPI al importar sus módulos.

Ahora:

| Momento | Qué hace | Escribe en el esquema |
|---|---|---|
| Arranque (`npm run start`) | Comprueba el esquema (solo `SELECT`) y lo informa en los logs con el prefijo `[Schema]` | **No** |
| Mantenimiento explícito | Ejecuta los mismos pasos que antes hacía el arranque, en el mismo orden, con garantías | Sí, solo con `--apply` |

Los pasos de **datos** que no tocan el esquema siguen en el arranque sin cambios: corrección de URLs de facturas,
`WIPE_TEST_DATA` (nunca en producción) y la semilla de experiencias si la tabla está vacía.

## Comprobación del arranque (`SCHEMA_CHECK`)

| Valor | Comportamiento |
|---|---|
| `warn` (por defecto) | Si el esquema no está al día, lo registra como error y **arranca igualmente** (equivalente a lo que pasaba antes cuando una migración fallaba). |
| `strict` | Si el esquema no está al día, **no arranca** (código 1). Solo tiene sentido con un healthcheck en Railway; si no, un fallo deja el servicio caído. |
| `off` | No comprueba. |

Qué comprueba:

- **Migraciones de drizzle pendientes:** usa el mismo criterio que el migrador de drizzle, es decir, exactamente lo que antes se aplicaba al arrancar.
- **Tablas y columnas de `drizzle/schema.ts` que faltan en la BD.**
- **Ausencias conocidas y documentadas:** las 4 tablas RBAC (`docs/db/RECONCILIACION_ESQUEMA_2026-10-13.md`) se informan, pero no cuentan como fallo.

Ejemplo de log correcto:
```
[Schema] ✓ Esquema al día en «…»: sin migraciones pendientes; 152 tablas de schema.ts comprobadas.
```

## Mantenimiento explícito

```bash
# Plan (solo lectura): estado y pasos que se ejecutarían
node dist/index.js --schema-maintenance
# Ejecutar
node dist/index.js --schema-maintenance --apply --confirm-database <bd> [--allow-remote]

# En desarrollo (sin build):
pnpm exec tsx server/_core/index.ts --schema-maintenance [--apply --confirm-database <bd>]
```

Usa `DATABASE_URL` y nunca la imprime. Ofrece estas garantías:

- **Sin `--apply` no escribe nada.**
- **Identificación del destino:** `--apply` exige `--confirm-database` con el nombre real que devuelve el servidor, también en local. Si el destino no es local, exige además `--allow-remote`.
- **Bloqueo:** usa un bloqueo `GET_LOCK('nayade_schema_maintenance')`, así que dos mantenimientos a la vez no se pisan.
- **Parada segura:** los pasos heredados registran sus errores en lugar de lanzarlos. El mantenimiento los detecta, se detiene en el primer paso que falla (los siguientes **no** se ejecutan) y sale con código 1.
- **Verificación final:** al terminar, vuelve a comprobar el esquema; si sigue incompleto, sale con código 1.
- **Modo multiempresa:** en modo multi se niega a ejecutarse, porque cada tenant lo gestiona el aprovisionamiento.

Pasos, en orden:

1. `drizzle`
2. `ensureCriticalSeeds`
3. `migrateSiteSettingsToSystemSettings`
4. `ensurePricingColumns`
5. `ensureRefundColumns`
6. `ensureReservationPublicToken`
7. `ensureDiscountColumns`
8. `ensureLeadSourceColumn`
9. `ensureTicketingChannel`
10. `ensureExpenseEmailIngestionSchema`
11. `initGhlTables`
12. `initVapiTables`

## Procedimiento en producción (requiere autorización)

1. **Copia de seguridad verificada** de la BD.
2. **Plan** desde el contenedor del servicio: `node dist/index.js --schema-maintenance`. Revisar las migraciones pendientes y las ausencias.
3. **Ejecutar**, solo si hay algo pendiente y con autorización: `… --apply --confirm-database <bd> --allow-remote`.
4. **Desplegar** la versión que necesita ese esquema y comprobar en los logs `[Schema] ✓`.

**Railway:** `railway.toml` **no cambia** en este PR, así que un deploy ya no aplica migraciones. Si un PR futuro trae una migración de drizzle, hay dos opciones, ambas sujetas a decisión:

- seguir el procedimiento anterior antes de desplegar; o
- añadir un `preDeployCommand` en `railway.toml`. Es un cambio de configuración de Railway, en un PR propio y con autorización.

## Fuera de este cambio (riesgo residual documentado)

Hay DDL que **no** se ejecuta al arrancar, sino bajo demanda en tiempo de ejecución. No se toca aquí:

- `documentNumbers.ts` (`CREATE TABLE IF NOT EXISTS` al generar números);
- `commercialEmailService.ts` (al sincronizar, con el flag desactivado por defecto);
- `routers/crm.ts` → `setInvoiceExempt` (`ALTER TABLE reservations ADD COLUMN invoice_exempt` en cada llamada; en producción la columna ya existe y el error se ignora).

Conviene llevarlos al carril explícito en cambios aparte.
