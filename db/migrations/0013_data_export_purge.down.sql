-- Reversión de 0013_data_export_purge: se pierde la fecha de retirada de los ZIP (no los ZIP ni las filas).
-- Antes, desplegar el código anterior a la retirada automática.
ALTER TABLE data_exports
  DROP KEY ix_data_export_purge,
  DROP COLUMN purged_at;
