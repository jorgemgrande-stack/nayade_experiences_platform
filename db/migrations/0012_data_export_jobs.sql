-- Big Elephant — Exportaciones de datos como trabajo asíncrono (aditiva, BD de cada empresa).
--
-- Las exportaciones dejan de generarse dentro de la petición web: un trabajo las reclama con un arriendo
-- (heartbeat_at), las genera en streaming a un fichero temporal y las sube. Si el proceso se reinicia, el
-- arriendo caduca y otro intento la retoma (attempts) sin duplicar el ZIP. Se registra cuánto ocupa sin
-- comprimir y cuánto tardó (también en el gestor de recursos).
--
-- Solo añade columnas con valor por defecto o nulas: no cambia ni borra ningún dato existente. Nunca se
-- ejecuta al arrancar. Requiere 0011_data_exports.

ALTER TABLE data_exports
  ADD COLUMN attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN started_at BIGINT NULL,
  ADD COLUMN heartbeat_at BIGINT NULL,
  ADD COLUMN duration_ms BIGINT NULL,
  ADD COLUMN uncompressed_bytes BIGINT NULL,
  ADD COLUMN missing_files INT NULL,
  ADD KEY ix_data_export_status (status, requested_at);
