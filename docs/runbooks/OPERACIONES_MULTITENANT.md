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
