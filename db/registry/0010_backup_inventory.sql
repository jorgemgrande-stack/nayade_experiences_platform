-- Elephant Source — inventario de copias de seguridad (aditiva).
--   Una fila por copia intentada: de una empresa (target_kind = 'tenant'), del registro, del CRM
--   comercial o de los ficheros de una empresa. Sin secretos: ni DSN ni claves; solo el
--   identificador de la clave con la que se cifró la copia (`key_id`) y la ubicación del objeto.
--   Sin clave foránea a tenants: la copia de una empresa se conserva aunque la empresa se elimine.
-- Reversión: DROP TABLE backup_inventory; UPDATE registry_meta SET v = '0009' WHERE k = 'schema_version';

CREATE TABLE IF NOT EXISTS backup_inventory (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id         VARCHAR(36)  NOT NULL,
  target_kind    ENUM('tenant','registry','crm','files') NOT NULL,
  target_id      VARCHAR(63)  NOT NULL,
  status         ENUM('running','ok','failed','pruned') NOT NULL DEFAULT 'running',
  started_at     BIGINT       NOT NULL,
  finished_at    BIGINT       NULL,
  duration_ms    INT          NULL,
  server_alias   VARCHAR(64)  NULL,
  database_name  VARCHAR(64)  NULL,
  schema_version VARCHAR(64)  NULL,
  storage_kind   VARCHAR(8)   NULL,
  location       VARCHAR(600) NULL,
  manifest_key   VARCHAR(600) NULL,
  bytes          BIGINT       NULL,
  sha256         CHAR(64)     NULL,
  key_id         VARCHAR(32)  NULL,
  tables_count   INT          NULL,
  rows_count     BIGINT       NULL,
  error          VARCHAR(500) NULL,
  pruned_at      BIGINT       NULL,
  KEY idx_backup_target (target_kind, target_id, started_at),
  KEY idx_backup_status (status, started_at),
  KEY idx_backup_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0010' WHERE k = 'schema_version';
