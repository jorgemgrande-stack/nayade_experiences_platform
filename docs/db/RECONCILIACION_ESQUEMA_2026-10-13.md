# Conciliación de esquema y migraciones (2026-10-13)

Objetivo: saber con precisión en qué estado está el esquema de producción respecto a `drizzle/schema.ts` y a las migraciones, antes de crear una baseline para tenants nuevos y de tocar nada.

**Método (solo lectura):**
1. Metadatos de `information_schema` de producción obtenidos con una consulta `SELECT` en sesión de solo lectura ejecutada dentro del contenedor del servicio (estructura únicamente; ningún dato de negocio) y comparados con `drizzle/schema.ts` mediante `scripts/audit-schema-drift.ts`.
2. Aplicación de **todos** los `.sql` de `drizzle/` sobre un MySQL 8 local desechable (Docker) para medir qué esquema producen realmente los ficheros.

Herramienta: `scripts/audit-schema-drift.ts` (ver cabecera del fichero). Las operaciones que escriben (`--apply-*`) se rechazan si el host no es local.

---

## 1. Producción frente a `schema.ts`

Servidor de producción: **MySQL 9.7.2**. `__drizzle_migrations` tiene **184** filas (el journal del repositorio tiene 115 entradas).

| Comprobación | Resultado |
|---|---|
| Tablas en `schema.ts` / en producción | 152 / 152 |
| Tablas declaradas en `schema.ts` que **no existen** en producción | 4: `rbac_roles`, `rbac_permissions`, `rbac_role_permissions`, `rbac_user_roles` |
| Tablas en producción que **no** están en `schema.ts` | 4: `commercial_communications`, `commercial_followup_rules`, `commercial_followup_settings`, `partner_allowed_products` |
| Columnas de `schema.ts` que faltan en producción | **0** |
| Columnas en producción fuera de `schema.ts` | 3: `commercial_emails.attachments_meta`, `quotes.partnerId`, `reservations.invoice_exempt` |
| Diferencias de tipo | 1: `hr_schedule_templates.weekday` (esperado `int`, real `tinyint`) |
| `NOT NULL` esperado pero nullable | 0 |

### Lectura
- **El esquema de producción es funcionalmente coherente con `schema.ts`**: ninguna columna que el código espere falta. La deriva es de dos tipos: restos y extras.
- **Las 4 tablas RBAC no existen en producción.** Consecuencia práctica: `getUserPermissions()` lanza (tabla inexistente) y `checkRbacOrLegacy()` cae siempre al **fallback de roles heredados** (`users.role`). El control de acceso efectivo hoy es por rol heredado, no por RBAC.
  - **No aplicar las migraciones `0069`–`0078` en producción sin antes sembrar todos los permisos usados en código.** Si se crearan las tablas vacías o incompletas, las comprobaciones pasarían de «fallback por rol» a «RBAC-first sin permisos» y se denegaría el acceso a usuarios legítimos (p. ej. `hr.view`, `gestoria.*` no están sembrados en ninguna migración).
- `partner_allowed_products` y `quotes.partnerId` proceden de la migración de la rama `feature/partners-landing` (incidente del 2026-05-01): **llegaron a producción** y no están en `schema.ts`. Son inocuos pero demuestran que la BD real y el modelo divergen.
- `reservations.invoice_exempt` (migración `0091`) y `commercial_emails.attachments_meta` existen en producción y no en `schema.ts`.

## 2. Qué producen los ficheros `.sql`

Aplicados todos los ficheros (124) en orden numérico sobre MySQL 8.0 vacío, tolerando errores:

| Medida | Resultado |
|---|---|
| Sentencias OK / con error | 606 / 66 |
| Ficheros con errores | 21 |
| Tablas resultantes | 150 de 152 (faltan `payment_plans`, `payment_installments`) |
| Columnas de `schema.ts` ausentes | 36 (en 12 tablas) |

Causas verificadas:

1. **13 ficheros usan `ADD COLUMN IF NOT EXISTS`**, sintaxis de MariaDB que MySQL (8.x y 9.x) **no admite** (`ER_PARSE_ERROR`). No pueden haberse aplicado tal cual en producción: se aplicaron con scripts (`scripts/apply-*.cjs`) o por DDL del arranque.
2. **`migrate()` sobre una BD vacía falla en la migración `0045`** (fichero escrito a mano con varias sentencias sin separadores): **una BD nueva no se puede construir desde el journal**.
3. `0078_controler_role` referencia `isLegacy` en una tabla (RBAC) que su propia cadena no crea.
4. `0079_flowery_cerise` recrea 20 tablas ya creadas por migraciones previas (no idempotente).
5. `payment_plans` y `payment_installments` no las crea ninguna migración: las crea el DDL en caliente del arranque (`server/_core/index.ts`).

## 3. Conclusiones

| # | Conclusión | Consecuencia |
|---|---|---|
| C1 | Ni el journal ni los `.sql` reproducen el esquema de producción | La baseline para tenants nuevos **no puede generarse desde las migraciones**; debe salir del DDL real de producción |
| C2 | Producción y `schema.ts` coinciden en lo que el código usa | Es seguro tomar el DDL de producción como fuente de verdad |
| C3 | RBAC nunca se aplicó | Cualquier trabajo de RBAC es previo a activarlo; hoy rige el rol heredado |
| C4 | Tablas/columnas huérfanas en producción | Documentadas; no se eliminan (sin datos que justifiquen riesgo) |
| C5 | El DDL del arranque cubre huecos de las migraciones | Hay que migrarlo a una baseline versionada antes de retirarlo |

## 4. Plan (cada paso, un PR pequeño y reversible)

1. **Baseline desde el DDL real** (`SHOW CREATE TABLE` de producción, solo estructura): `baseline/0000_baseline.sql` para BD nuevas (tenants, preproducción, CI). El histórico de migraciones **no se toca** (las BD existentes siguen su camino).
2. **Prueba de equivalencia en CI:** baseline aplicada a MySQL vacío ⇒ `audit-schema-drift` sin diferencias de columnas con `schema.ts`.
3. **Alinear `schema.ts`** con las 3 columnas y 4 tablas extra de producción **solo si** el código las va a usar (decisión caso a caso; por ahora no).
4. **Runner de migraciones explícito** (paso de release, fallo visible) en lugar de `runMigrations()` con error tragado en el arranque.
5. **RBAC:** sembrar permisos desde código y comprobar equivalencia con el fallback antes de crear las tablas en producción.

## 5. Reproducir

```bash
# Auditoría contra volcado de metadatos (sin BD)
pnpm exec tsx scripts/audit-schema-drift.ts --actual-json volcado.json --json informe.json

# Auditoría contra una BD local desechable
docker run -d --name drift-mysql -e MYSQL_ROOT_PASSWORD=drift -e MYSQL_DATABASE=drift -p 127.0.0.1:3317:3306 mysql:8.0
DRIFT_DATABASE_URL=mysql://root:drift@127.0.0.1:3317/drift \
  pnpm exec tsx scripts/audit-schema-drift.ts --apply-all
```
