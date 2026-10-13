-- ============================================================================
-- Registro de tenants — esquema v1.5.0: incidencias operativas
-- ============================================================================

CREATE TABLE IF NOT EXISTS ops_incidents (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  dedupe_key      VARCHAR(160) NOT NULL,
  tenant_id       VARCHAR(63)  NULL,
  kind            VARCHAR(60)  NOT NULL,
  severity        ENUM('info','warning','critical') NOT NULL,
  title           VARCHAR(200) NOT NULL,
  details         JSON         NULL,
  status          ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  opened_at       BIGINT       NOT NULL,
  last_seen_at    BIGINT       NOT NULL,
  occurrences     INT          NOT NULL DEFAULT 1,
  acknowledged_by VARCHAR(100) NULL,
  resolved_at     BIGINT       NULL,
  resolved_by     VARCHAR(100) NULL,
  KEY idx_incident_key (dedupe_key, status),
  KEY idx_incident_status (status, opened_at),
  KEY idx_incident_tenant (tenant_id, opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0005' WHERE k = 'schema_version';
