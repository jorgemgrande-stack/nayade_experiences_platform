-- Importación de medios y contenidos de Elephant Studio. Aditiva, BD de cada empresa (nada compartido entre tenants).
--
-- `studio_import_runs`: auditoría de cada importación APLICADA (quién, cuándo, opciones, resumen e informe completo).
--   Un ensayo (dry-run) no escribe nada, tampoco aquí.
-- `studio_import_media`: manifiesto de medios traídos por URL: hash SHA-256 del original (único por empresa: detección
--   de duplicados), objeto almacenado, URL de origen, nombre original, tipo, tamaño, fecha de captura e importación.
-- `studio_import_pages`: huella de lo que la importación escribió en cada página (hash del contenido importado y hash
--   del estado resultante) para ser idempotente y no pisar ediciones manuales. Guarda el idioma opcional (multidioma).
--
-- Solo crea tablas. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS studio_import_runs (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  run_id          VARCHAR(64)   NOT NULL,
  actor           VARCHAR(120)  NOT NULL,
  schema_version  INT           NOT NULL,
  flags           VARCHAR(500)  NOT NULL,
  summary         TEXT          NOT NULL,
  report          MEDIUMTEXT    NOT NULL,
  created_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_studio_import_runs_run (run_id),
  KEY idx_studio_import_runs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS studio_import_media (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sha256            CHAR(64)      NOT NULL,
  object_id         CHAR(26)      NOT NULL,
  url               VARCHAR(1000) NOT NULL,
  source_url        VARCHAR(2048) NOT NULL,
  source_url_hash   CHAR(64)      NOT NULL,
  original_filename VARCHAR(256)  NOT NULL,
  content_type      VARCHAR(128)  NOT NULL,
  size_bytes        BIGINT        NOT NULL,
  captured_at       BIGINT        NOT NULL,
  import_run_id     VARCHAR(64)   NOT NULL,
  alt               VARCHAR(300)  NULL,
  license           VARCHAR(200)  NULL,
  credit            VARCHAR(300)  NULL,
  source_note       VARCHAR(500)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_studio_import_media_sha (sha256),
  KEY idx_studio_import_media_source (source_url_hash),
  KEY idx_studio_import_media_run (import_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS studio_import_pages (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(256)  NOT NULL,
  content_hash    CHAR(64)      NOT NULL,
  written_hash    CHAR(64)      NOT NULL,
  locale          VARCHAR(35)   NULL,
  import_run_id   VARCHAR(64)   NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_studio_import_pages_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
