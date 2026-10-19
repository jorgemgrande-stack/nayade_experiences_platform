-- Big Elephant — Exportaciones de datos de la empresa (aditiva, BD de cada empresa).
--
-- Cada fila es una solicitud de exportación (ZIP con CSV, JSON y ficheros) del propietario de la empresa:
-- quién la pidió, cuándo, su estado, el fichero generado (stored_objects, categoría `data-export`), su tamaño y
-- recuentos, la caducidad del enlace (24 h) y cada enlace emitido y descarga. Es la auditoría de la exportación:
-- nunca se borra nada automáticamente (ni la fila ni el fichero).
--
-- No cambia ningún dato existente. Nunca se ejecuta al arrancar. Diseño: docs/elephant-source/DISENO_COMPRA_MODULOS.md
-- (decisión D: ZIP con CSV, JSON y ficheros; enlace firmado de 24 h; solo el propietario).

CREATE TABLE data_exports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requested_by INT NOT NULL,
  status ENUM('pending','ready','failed') NOT NULL DEFAULT 'pending',
  object_id VARCHAR(64) NULL,
  size_bytes BIGINT NULL,
  table_count INT NULL,
  row_count INT NULL,
  file_count INT NULL,
  error VARCHAR(300) NULL,
  requested_at BIGINT NOT NULL,
  completed_at BIGINT NULL,
  expires_at BIGINT NULL,
  link_count INT NOT NULL DEFAULT 0,
  last_link_at BIGINT NULL,
  download_count INT NOT NULL DEFAULT 0,
  last_download_at BIGINT NULL,
  -- Como mucho una exportación en curso por empresa
  pending_slot TINYINT GENERATED ALWAYS AS (IF(status = 'pending', 1, NULL)) STORED,
  UNIQUE KEY uq_data_export_pending (pending_slot),
  KEY ix_data_export_object (object_id),
  CONSTRAINT chk_data_export_counts CHECK (link_count >= 0 AND download_count >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
