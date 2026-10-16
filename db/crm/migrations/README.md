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
| `0003_crm_web_requests` | Solicitudes de la web pública (`crm_lead_requests`): cuelgan de un lead (FK), con tipo, estado de atención, configuración elegida (JSON), mensaje, preferencia horaria, consentimientos con versión, clave de idempotencia única, huella del contenido e IP seudonimizada. Aditiva; la reversión borra solo las solicitudes. |
| `0004_web_catalog` | Catálogo comercial y contenidos de la web administrados desde el CRM: `web_entries` (borrador versionado + copia publicada), `web_entry_versions` (historial), `web_prices` (importes inmutables con aprobación) y `web_events` (auditoría). Aditiva; la reversión elimina el catálogo y su historial. Ver `docs/runbooks/WEB_COMERCIAL.md`. |
| `0005_web_prices_single_approved` | Índice único sobre una columna generada: como mucho un precio vigente por producto, tipo, moneda y unidad. Si ya hubiera duplicados vigentes la migración falla sin cambiar nada (consulta de comprobación en el propio fichero). La reversión solo quita el índice y la columna; no toca datos. |
| `0006_subscriptions` | Suscripciones v1 en **modo sombra**: `subscriptions` (una viva por contrato, versión optimista), `subscription_items` (instantánea inmutable del precio aceptado, FK a `web_prices`), `subscription_events` (historial), `subscription_usage` (consumos idempotentes), `shadow_invoices` (una por periodo y concepto), `shadow_charges` y `shadow_webhook_events` (cobros SIMULADOS). Aditiva; la reversión borra todo lo anterior. Ver `docs/runbooks/SUSCRIPCIONES_V1.md`. |
| `0007_trials` | Prueba autónoma de 15 días (preparación): `trial_requests` (una abierta por correo, idempotencia, un tenant por prueba, solo el hash del token de verificación) y `trial_events` (historial). Nada se ejecuta solo. Aditiva; la reversión borra las solicitudes. Ver `docs/architecture/PRUEBA_AUTONOMA_15_DIAS.md`. |
| `0008_catalog_capabilities` | Catálogo oficial de Elephant Source: tipo de entrada `capability` (las 74 capacidades con id estable). Los campos comerciales nuevos de producto (familias Net y Connect, estado comercial, capacidades, paquetes, cupos y complementos) van en el JSON del borrador. Aditiva; la reversión borra solo las capacidades. Ver `docs/runbooks/CATALOGO_ELEPHANT_SOURCE.md`. |
