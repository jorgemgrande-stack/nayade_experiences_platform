# Migraciones de la BD del CRM comercial

`db/crm/0000_crm.sql` es el esquema base. Los cambios posteriores viven aquí y se aplican con el
ejecutor común (`scripts/db/migrate.ts`, misma convención que `db/migrations/`: `NNNN_nombre.sql` +
`.down.sql`, dry-run por defecto, bloqueo, checksums inmutables):

```bash
pnpm exec tsx scripts/db/migrate.ts verify --dir db/crm/migrations
MIGRATE_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/db/migrate.ts status --dir db/crm/migrations
MIGRATE_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations          # dry-run
MIGRATE_DATABASE_URL=mysql://…/crm pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations --apply
```

**Orden de despliegue:** aplicar las migraciones del CRM *antes* de arrancar una versión del plano
de control que las necesite (el código v2 escribe columnas de `0001`).

| Migración | Contenido |
|---|---|
| `0001_crm_commercial_v2` | Ficha fiscal/contacto y estado de empresas; contactos con nombre/apellidos, principal único, estado y notas; prioridad y empresa del lead; pipeline con etapas `contacted`, `qualification`, `demo`; plan, módulos, contacto y próxima acción en oportunidades. Aditiva; la reversión reasigna las etapas nuevas a `prospecting`. |
| `0002_crm_contracts_v2` | Contratos: referencia única `CT-AAAA-NNNNNN` (rellena las existentes), condiciones, periodicidad, renovación (fecha, automática, preaviso), versión vigente, contrato anterior (renovaciones), método y referencia de firma (preparado para firma electrónica futura) y tabla `crm_contract_versions` con instantáneas inmutables. La reversión elimina el historial de versiones. |
