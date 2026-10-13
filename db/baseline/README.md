# Baseline de esquema (bases de datos nuevas)

`0000_baseline.sql` crea el esquema completo (152 tablas) en una base de datos **vacía**: nuevos tenants, entornos de preproducción y CI.

## Por qué existe
Las migraciones de `drizzle/` **no pueden construir una BD vacía** (ver `docs/db/RECONCILIACION_ESQUEMA_2026-10-13.md`): `migrate()` falla en la `0045`, 13 ficheros usan sintaxis MariaDB (`ADD COLUMN IF NOT EXISTS`) y parte del esquema la crea el DDL del arranque. La baseline sale del DDL **real** de producción.

## Qué es y qué no es
- **Es** la estructura (sin datos) de producción a 2026-10-13, verificada: 2.271 columnas idénticas a las de producción.
- **No** se aplica a bases de datos existentes: estas siguen su camino incremental.
- **No** incluye datos de arranque (roles, permisos, ajustes por defecto, administrador inicial). Eso es el *seed* por tenant, un paso aparte.
- **Diferencia deliberada** con producción: el `DEFAULT` de `internalAlertEmail` es `''` (en producción llevaba el correo de un cliente concreto).
- Contiene `CREATE TABLE IF NOT EXISTS` y es idempotente.

## Carencias conocidas respecto a `drizzle/schema.ts`
Producción no tiene las 4 tablas `rbac_*` que declara `schema.ts` (RBAC nunca se aplicó). Para un tenant nuevo que use RBAC habrá que añadirlas **y sembrarlas** en un paso explícito antes de activarlo.

## Cómo comprobarlo
```bash
docker run -d --name baseline-mysql -e MYSQL_ROOT_PASSWORD=drift -e MYSQL_DATABASE=drift -p 127.0.0.1:3317:3306 mysql:8.0
docker exec -i baseline-mysql mysql -uroot -pdrift drift < db/baseline/0000_baseline.sql
DRIFT_DATABASE_URL=mysql://root:drift@127.0.0.1:3317/drift pnpm exec tsx scripts/audit-schema-drift.ts
```
El CI ejecuta esta misma comprobación en cada PR (job «Baseline de esquema»).

## Cómo regenerarla
Con el esquema real como fuente: `SHOW CREATE TABLE` de cada tabla en una sesión de solo lectura, sin `AUTO_INCREMENT=` y con `CREATE TABLE IF NOT EXISTS`. Revisar siempre los `DEFAULT` que contengan datos de un cliente concreto.
