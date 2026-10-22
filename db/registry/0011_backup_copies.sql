-- Elephant Source — copias por destino y registro de restauraciones (aditiva).
--   backup_copies: estado de cada copia en cada destino ADICIONAL al primario (hoy, el secundario
--     externo) y del paquete de configuración para recuperación (backup_id NULL). El estado del
--     destino primario sigue en backup_inventory (sin cambios). Cada destino tiene su propia
--     retención: `pruned` aquí no afecta a backup_inventory ni al revés.
--   backup_restores: una fila por restauración intentada (empresa, registro, CRM o ficheros), con su
--     origen (primario o secundario), resultado, verificación y conmutación.
--   Sin secretos: ni DSN ni claves ni credenciales; `storage` es la descripción sin credenciales.
-- Reversión: DROP TABLE backup_restores; DROP TABLE backup_copies; UPDATE registry_meta SET v = '0010' WHERE k = 'schema_version';

CREATE TABLE IF NOT EXISTS backup_copies (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  backup_id     BIGINT       NULL,
  destination   VARCHAR(16)  NOT NULL,
  run_id        VARCHAR(36)  NOT NULL,
  target_kind   VARCHAR(16)  NOT NULL,
  target_id     VARCHAR(63)  NOT NULL,
  status        ENUM('ok','failed','pruned') NOT NULL,
  storage       VARCHAR(200) NULL,
  location      VARCHAR(600) NULL,
  manifest_key  VARCHAR(600) NULL,
  bytes         BIGINT       NULL,
  sha256        CHAR(64)     NULL,
  started_at    BIGINT       NOT NULL,
  finished_at   BIGINT       NOT NULL,
  duration_ms   INT          NOT NULL,
  error         VARCHAR(500) NULL,
  pruned_at     BIGINT       NULL,
  UNIQUE KEY uq_backup_copy (backup_id, destination),
  KEY idx_copy_target (destination, target_kind, target_id, started_at),
  KEY idx_copy_status (destination, status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS backup_restores (
  id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  started_at    BIGINT       NOT NULL,
  finished_at   BIGINT       NULL,
  actor         VARCHAR(100) NOT NULL,
  source        VARCHAR(16)  NOT NULL,
  target_kind   VARCHAR(16)  NOT NULL,
  target_id     VARCHAR(63)  NOT NULL,
  backup_id     BIGINT       NULL,
  manifest_key  VARCHAR(600) NULL,
  server_alias  VARCHAR(64)  NULL,
  database_name VARCHAR(64)  NULL,
  status        ENUM('running','ok','failed') NOT NULL DEFAULT 'running',
  verified      TINYINT(1)   NOT NULL DEFAULT 0,
  switched      TINYINT(1)   NOT NULL DEFAULT 0,
  files_count   INT          NULL,
  error         VARCHAR(500) NULL,
  KEY idx_restore_target (target_kind, target_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0011' WHERE k = 'schema_version';
