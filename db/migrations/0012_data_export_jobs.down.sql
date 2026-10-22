-- Reversión de 0012_data_export_jobs: se pierden los intentos, el arriendo y las métricas de cada exportación
-- (no los ZIP ni su registro de 0011). Antes, desplegar el código anterior a la exportación asíncrona.
ALTER TABLE data_exports
  DROP KEY ix_data_export_status,
  DROP COLUMN missing_files,
  DROP COLUMN uncompressed_bytes,
  DROP COLUMN duration_ms,
  DROP COLUMN heartbeat_at,
  DROP COLUMN started_at,
  DROP COLUMN attempts;
