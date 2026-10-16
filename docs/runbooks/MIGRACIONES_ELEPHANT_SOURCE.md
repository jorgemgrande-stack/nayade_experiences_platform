# Migraciones de Elephant Source: procedimiento, copia y recuperación

**Alcance:** CRM `0008_catalog_capabilities` y `0009_contract_configuration`, registro `0008_tenant_capabilities` y `0009_sites_fiscal_entities`, y la semilla del catálogo v1.

**Naturaleza de los cambios:** todas son aditivas (tablas o columnas nuevas, sin tocar datos existentes).

**Estado:** ensayadas el 16/10/2026 en una base MySQL 8.4 desechable. **No ejecutadas en ninguna base real.**

**Bloqueo:** no hay acceso a las bases de producción desde este entorno. La ejecución real la hace una persona con acceso, siguiendo este documento.

## Reglas
- Nunca al arrancar: cada paso es un comando explícito, con `--apply`/`--execute` y la confirmación del nombre de la base.
- Antes de escribir: **copia verificada** (ver «Copia» abajo). Sin copia restaurable no se migra.
- Orden: CRM → semilla → registro → despliegue del código que las usa. El código nuevo funciona sin ellas (las funciones nuevas quedan inactivas hasta que existan las tablas), así que el orden inverso no rompe el servicio, pero tampoco activa nada.

## Copia
```bash
mysqldump --single-transaction --routines --triggers <bd> > copia_<bd>_$(date +%Y%m%d_%H%M).sql
```
**Verificar la copia** antes de seguir: restaurarla en una base temporal y comparar el número de tablas y los recuentos de las tablas principales.
```bash
mysql -e "CREATE DATABASE <bd>_verif"
mysql <bd>_verif < copia_….sql
```
La copia no sale del entorno controlado: contiene datos personales.

## CRM (carril `db/crm/migrations`, ejecutor común)
```bash
MIGRATE_DATABASE_URL=mysql://…/<crm> pnpm exec tsx scripts/db/migrate.ts status --dir db/crm/migrations
MIGRATE_DATABASE_URL=mysql://…/<crm> pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations            # plan
MIGRATE_DATABASE_URL=mysql://…/<crm> pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations --apply --confirm-database <crm> [--allow-remote]
```
**Reversión** (tiene ficheros `.down.sql`):
```bash
MIGRATE_DATABASE_URL=… pnpm exec tsx scripts/db/migrate.ts down --dir db/crm/migrations --steps 2 --apply --confirm-database <crm>
```
- `0009.down` quita `crm_contracts.configuration`; las versiones del contrato conservan su copia.
- `0008.down` borra solo las entradas de tipo capacidad; los productos de la semilla permanecen (su configuración nueva va en el JSON del borrador).

## Semilla del catálogo (base del CRM, tras `0008`)
```bash
CATALOG_DATABASE_URL=mysql://…/<crm> pnpm exec tsx scripts/catalog/seed-elephant-source.ts                               # simulación
CATALOG_DATABASE_URL=mysql://…/<crm> pnpm exec tsx scripts/catalog/seed-elephant-source.ts --apply --confirm-database <crm>
```
- Idempotente: la segunda ejecución informa `unchanged`.
- Nunca despublica ni borra.
- Si una clave existe con otra familia, la informa en `conflicts` y no la toca. **Si `conflicts` no está vacío, para y revisa.**

## Registro (ejecutor propio)
```bash
REGISTRY_MIGRATE_URL=mysql://…/<registro> pnpm exec tsx scripts/registry-migrate.ts                                        # plan
REGISTRY_MIGRATE_URL=mysql://…/<registro> pnpm exec tsx scripts/registry-migrate.ts --execute --confirm-database <registro> [--allow-remote]
```
**Reversión** (sin `.down`; las cuatro tablas son nuevas y no las referencia nada anterior). Solo si están vacías o se acepta perder su contenido:
```sql
DROP TABLE tenant_sites; DROP TABLE tenant_fiscal_entities;              -- 0009 (en este orden, por la FK)
DROP TABLE tenant_capability_events; DROP TABLE tenant_capabilities;     -- 0008
UPDATE registry_meta SET v = '0007' WHERE k = 'schema_version';
```
Si ya contienen licencias, sedes o entidades fiscales reales, **no** revertir así: restaurar desde la copia.

## Recuperación completa
Restaurar la copia sobre una base nueva y apuntar el servicio a ella, o restaurarla sobre la original con el servicio detenido. Después, `status` (CRM) o el plan (registro) deben mostrar la versión anterior.

## Resultado del ensayo (16/10/2026, base desechable)

**CRM**
| Paso | Resultado |
|---|---|
| Base en `0007` con 2 empresas sintéticas | ✓ |
| Copia `mysqldump` | ✓ (34 KB) |
| Plan | 2 pendientes (`0008`, `0009`) |
| Aplicación | ✓ (`crm_contracts.configuration` JSON) |
| Semilla: simulación | sin escritura |
| Semilla: aplicación | 132 entradas, 60 precios, `conflicts: []` |
| Semilla: repetición | `unchanged: 132` |
| Reversión de `0009` y `0008` | ✓ (aplicadas 7, pendientes 2); empresas intactas (2) |
| Restauración de la copia en otra base | ✓ (23 tablas, 2 empresas, versión `0007`) |

**Registro**
| Paso | Resultado |
|---|---|
| Base en `0007` | ✓ |
| Copia | ✓ (22 KB) |
| Plan | `0007` → `0009` |
| Ejecución | ✓ (`tenant_capabilities`, `tenant_capability_events`, `tenant_sites`, `tenant_fiscal_entities`) |
| Reversión manual | ✓ (el plan vuelve a mostrar `0008` y `0009` pendientes) |

## Pendiente
- **Ejecución real:** requiere acceso a las bases y una persona responsable de la copia. Además, **la copia de producción debe ensayarse primero en una base aislada** con este mismo procedimiento.
- Las migraciones nuevas de los PR de sobreventa (hotel y spa) y de Ski Rental (carril de la app) se documentan en sus PR y no forman parte de esta tanda.
