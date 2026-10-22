-- Big Elephant — Retirada de los ZIP de exportación caducados (aditiva, BD de cada empresa).
--
-- Los ZIP generados son COPIAS temporales: se retiran del almacenamiento 7 días después de generarse, cuando su
-- enlace (24 h como mucho) ya ha caducado. La fila de `data_exports` se conserva (auditoría) con la fecha de
-- retirada. Nunca se tocan los datos ni los ficheros originales de la empresa.
--
-- Solo añade una columna nula y un índice. Nunca se ejecuta al arrancar. Requiere 0011 y 0012.

ALTER TABLE data_exports
  ADD COLUMN purged_at BIGINT NULL,
  ADD KEY ix_data_export_purge (purged_at, completed_at);
