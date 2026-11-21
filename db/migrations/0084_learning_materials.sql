-- Elephant Learning · gestión de materiales (lote 2). Aditiva: solo crea una tabla.
--   learning_resource_files: historial de ficheros de cada recurso. Subir un fichero nuevo crea una fila `staged` (pendiente de
--     publicar): los alumnos siguen recibiendo el fichero vigente de `learning_resources`. Publicar lo activa y deja el anterior
--     como `replaced` (sigue en el almacén y se puede recuperar). Nada se borra: la limpieza de ficheros sin referencias es otra
--     operación, protegida. El id del recurso no cambia, así que bloques, lecciones, progreso, matrículas y reglas no se ven afectados.
CREATE TABLE IF NOT EXISTS learning_resource_files (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  resource_id      INT UNSIGNED NOT NULL,
  stored_object_id VARCHAR(26) NOT NULL,
  sha256           CHAR(64) NOT NULL,
  size_bytes       BIGINT NOT NULL,
  mime_type        VARCHAR(120) NOT NULL,
  original_name    VARCHAR(300) NULL,
  status           ENUM('staged','active','replaced') NOT NULL,
  note             VARCHAR(300) NULL,
  created_by       INT NULL,
  created_at       BIGINT NOT NULL,
  activated_at     BIGINT NULL,
  replaced_at      BIGINT NULL,
  PRIMARY KEY (id),
  KEY idx_learning_resource_files_resource (resource_id, status),
  KEY idx_learning_resource_files_object (stored_object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
