# Propuesta de índice (pendiente de revisión; NO aplicada) para `latestAttempts`

Contexto: la corrección de `GET /cp/v1/backups` se hace solo con reescritura de consulta, sin migración.
Esta propuesta es opcional y queda pendiente de revisión y autorización del propietario.

## Estado actual

- `backup_inventory` (0010): `KEY idx_backup_target (target_kind, target_id, started_at)`.
- `backup_copies` (0011): `KEY idx_copy_target (destination, target_kind, target_id, started_at)`.

La consulta nueva agrega `MAX(started_at)` por (`target_kind`, `target_id`) con `status <> 'pruned'`. Con los
índices actuales MySQL recorre el índice (sin acceso a la tabla para esa agregación salvo por `status`).

## Índice propuesto (opcional)

```sql
ALTER TABLE backup_inventory ADD KEY idx_backup_latest (target_kind, target_id, status, started_at, id);
ALTER TABLE backup_copies    ADD KEY idx_copy_latest   (destination, target_kind, target_id, status, started_at, id);
```

- Justificación: hace que la agregación (incluido el filtro por `status`) y el desempate por `id` se resuelvan solo con el índice (cubriente), sin leer filas de la tabla.
- Riesgo: bajo. Índice secundario extra (más espacio y algo más de coste en INSERT/UPDATE, tablas de escritura escasa). `ADD KEY` en InnoDB es online (`ALGORITHM=INPLACE, LOCK=NONE`) en MySQL 8.
- Reversión: eliminar los dos índices añadidos (ALTER TABLE sobre cada tabla, sin pérdida de datos).
- Recomendación: medir primero en producción tras desplegar la consulta nueva; solo crear si el endpoint sigue lento.
- Mitigación complementaria, no incluida: la retención podría borrar o archivar filas `pruned` antiguas para acotar el crecimiento de la tabla.
