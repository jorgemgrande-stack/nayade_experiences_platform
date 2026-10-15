# Migraciones (nuevo carril)

Directorio de las migraciones **nuevas**, gestionadas por `scripts/db/migrate.ts`. El histórico de `drizzle/` **no se toca**: las bases de datos existentes siguen su camino, y las nuevas arrancan de `db/baseline/0000_baseline.sql`.

## Por qué un carril nuevo
Las migraciones de `drizzle/` no son reproducibles (ver `docs/db/RECONCILIACION_ESQUEMA_2026-10-13.md`) y se aplicaban en el arranque con el error tragado. Este carril es explícito, verificable y reversible.

## Convención
```
db/migrations/
  0001_nombre_corto.sql        # hacia delante (obligatoria)
  0001_nombre_corto.down.sql   # reversión (obligatoria salvo irreversible)
```
- Numeración contigua de 4 cifras; **el número se asigna al fusionar** (cola serie de migraciones).
- Aditivas y compatibles hacia atrás (expand/contract): nada destructivo en la misma versión que el código que ya no lo usa.
- Separador de sentencias: `;` al final de línea o `--> statement-breakpoint`.
- Una migración **no se edita** una vez aplicada en cualquier entorno: se crea otra.

## Marcas
| Marca (primera línea del `.sql`) | Efecto |
|---|---|
| `-- irreversible: motivo` | No exige `.down.sql`. `down` se niega a revertirla |
| `-- allow-destructive` | Permite `DROP TABLE/COLUMN`, `TRUNCATE` y `DELETE` sin `WHERE`. Exige backup verificado |

## Qué rechaza `verify`
Numeración duplicada o con huecos, nombres no válidos, falta de reversión sin marca, ficheros sin sentencias y sintaxis que **MySQL no admite** (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`: es sintaxis de MariaDB y ya rompió el histórico).

## Uso
```bash
pnpm exec tsx scripts/db/migrate.ts verify                       # sin base de datos
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts status
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts up                 # dry-run
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts up --apply
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts down --steps 1 --apply
```
- Sin `--apply` solo informa (dry-run).
- Contra una base de datos **no local** exige además `--confirm-database <nombre>`.
- Bloqueo de sesión: no corren dos ejecutores a la vez.
- Si una migración ya aplicada cambió de contenido, aborta.
- Un fallo detiene la ejecución con código 1 y la migración **no** se registra como aplicada.

## Procedimiento antes de tocar un esquema real
1. `verify` en CI (automático en cada PR).
2. Aplicar en preproducción con copia anonimizada y comprobar la reversión (`down`).
3. Backup verificado de la base de datos real.
4. `up` en dry-run; revisar; `up --apply --confirm-database <nombre>`.
5. Verificar la aplicación (`/readyz`, flujos críticos). Si falla: `down`.

> El arranque de la aplicación **no** ejecuta este carril ni, desde `fix/startup-sin-migraciones`, las migraciones de drizzle ni el DDL `ensure*`: solo comprueba el esquema. Ver `docs/runbooks/MANTENIMIENTO_ESQUEMA.md`.
