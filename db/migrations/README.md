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
pnpm exec tsx scripts/db/migrate.ts verify --dir db/migrations                       # sin base de datos
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts status --dir db/migrations
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts up --dir db/migrations      # dry-run
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts up --dir db/migrations --apply --confirm-database <bd>
MIGRATE_DATABASE_URL=mysql://... pnpm exec tsx scripts/db/migrate.ts down --dir db/migrations --steps 1 --apply --confirm-database <bd>
```
- `--dir` es **obligatorio** (no hay carril por defecto). Carriles: `db/migrations` (app, exige la tabla `users`) y `db/crm/migrations` (CRM, exige `crm_companies`), o un directorio con `lane.json` (`{"name": "...", "requires": ["tabla"]}`). La BD queda ligada a su carril (`__elephant_migrations_meta`): otro carril sobre ella se rechaza.
- `verify`, `status` y el dry-run **no escriben nada**.
- Escribir exige `--apply` y `--confirm-database <nombre>` igual al que devuelve el servidor, **también en local**. Un destino remoto exige además `--allow-remote`.
- Bloqueo de sesión y relectura del registro tras obtenerlo: dos ejecutores a la vez nunca aplican dos veces la misma migración.
- Si una migración falla a medias, la BD queda marcada y el ejecutor se niega a continuar. Tras revisar el esquema a mano: `resolve --dir <carril> --id <NNNN_nombre> --as applied|not-applied --apply --confirm-database <bd>`.
- Huecos (una migración sin aplicar con posteriores aplicadas) y registros de otro carril también detienen la ejecución.
- Si una migración ya aplicada cambió de contenido, aborta.
- Un fallo detiene la ejecución con código 1 y la migración **no** se registra como aplicada.

## Procedimiento antes de tocar un esquema real
1. `verify` en CI (automático en cada PR).
2. Aplicar en preproducción con copia anonimizada y comprobar la reversión (`down`).
3. Backup verificado de la base de datos real.
4. `up` en dry-run; revisar; `up --apply --confirm-database <nombre>`.
5. Verificar la aplicación (`/readyz`, flujos críticos). Si falla: `down`.

> El arranque de la aplicación **no** ejecuta este carril. Retirar `runMigrations()` del arranque se hará en un cambio aparte, una vez verificado este flujo en producción.
