-- Metadatos de los ficheros de la empresa (almacenamiento persistente). Aditiva y reversible: solo crea
-- una tabla nueva; no toca datos existentes. Cada empresa tiene su propia base de datos, así que la
-- empresa es implícita (no hay columna de empresa).
--  - object_id: identificador opaco (no correlativo) que aparece en las URL del Core.
--  - storage_key: clave del objeto en el bucket (en multiempresa siempre bajo `t/<empresa>/o/`).
--  - visibility: public (catálogo, logotipos, web, blog) | private (todo lo demás).
--  - status: pending (subiendo) | active | replaced (sustituido por replaced_by) | deleted | failed.
--  - bytes_removed_at: cuándo se borró el contenido del bucket (borrado o limpieza de huérfanos).
--  - Fechas en milisegundos desde epoch.
CREATE TABLE IF NOT EXISTS stored_objects (
  id                 BIGINT        NOT NULL AUTO_INCREMENT,
  object_id          CHAR(26)      NOT NULL,
  storage_key        VARCHAR(512)  NOT NULL,
  visibility         VARCHAR(8)    NOT NULL,
  category           VARCHAR(40)   NOT NULL,
  content_type       VARCHAR(120)  NOT NULL,
  size_bytes         BIGINT        NOT NULL,
  sha256             CHAR(64)      NOT NULL,
  original_name      VARCHAR(200)  NULL,
  owner_type         VARCHAR(40)   NULL,
  owner_id           VARCHAR(64)   NULL,
  uploaded_by        INT           NULL,
  status             VARCHAR(12)   NOT NULL DEFAULT 'pending',
  replaces_object_id CHAR(26)      NULL,
  replaced_by        CHAR(26)      NULL,
  error              VARCHAR(255)  NULL,
  created_at         BIGINT        NOT NULL,
  updated_at         BIGINT        NOT NULL,
  confirmed_at       BIGINT        NULL,
  deleted_at         BIGINT        NULL,
  bytes_removed_at   BIGINT        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stored_objects_object_id (object_id),
  UNIQUE KEY uq_stored_objects_storage_key (storage_key),
  KEY idx_stored_objects_owner (owner_type, owner_id),
  KEY idx_stored_objects_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
