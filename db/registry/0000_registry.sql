-- ============================================================================
-- Registro central de tenants — esquema v1.0.0
--
-- Base de datos SEPARADA de las de los tenants. El Core accede con un usuario de SOLO
-- LECTURA; las escrituras pasan por TenantRegistryService con un usuario de administración.
--
-- Contiene únicamente hechos operativos: sin planes, módulos contratados, facturación ni
-- datos de consumo. Los DSN solo existen cifrados (AES-256-GCM, ligados al tenant).
-- ============================================================================

CREATE TABLE IF NOT EXISTS registry_meta (
  k VARCHAR(64) NOT NULL PRIMARY KEY,
  v VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO registry_meta (k, v) VALUES ('contract_version', '1.0.0')
  ON DUPLICATE KEY UPDATE v = v;
INSERT INTO registry_meta (k, v) VALUES ('schema_version', '0000')
  ON DUPLICATE KEY UPDATE v = v;

CREATE TABLE IF NOT EXISTS tenants (
  id               VARCHAR(63)  NOT NULL PRIMARY KEY,
  display_name     VARCHAR(200) NOT NULL,
  status           ENUM('provisioning','trial','active','grace','suspended','archived','deleting','deleted')
                   NOT NULL DEFAULT 'provisioning',
  status_reason    VARCHAR(200) NULL,
  baseline_version VARCHAR(32)  NULL,
  schema_version   VARCHAR(64)  NULL,
  registry_version INT          NOT NULL DEFAULT 1,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_tenant_id CHECK (id REGEXP '^[a-z0-9][a-z0-9_-]{0,62}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_domains (
  domain             VARCHAR(253) NOT NULL PRIMARY KEY,
  tenant_id          VARCHAR(63)  NOT NULL,
  kind               ENUM('platform_subdomain','custom') NOT NULL,
  status             ENUM('pending_verification','verified','active','disabled','removed')
                     NOT NULL DEFAULT 'pending_verification',
  is_primary         TINYINT(1)   NOT NULL DEFAULT 0,
  -- columna generada: un único dominio primario por tenant (NULL no participa en la unicidad)
  primary_flag       TINYINT(1) GENERATED ALWAYS AS (IF(is_primary = 1, 1, NULL)) STORED,
  verification_token VARCHAR(64)  NULL,
  verified_at        TIMESTAMP(3) NULL,
  activated_at       TIMESTAMP(3) NULL,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_one_primary_per_tenant (tenant_id, primary_flag),
  KEY idx_domains_tenant (tenant_id),
  CONSTRAINT fk_domains_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_domain_lower CHECK (domain = LOWER(domain))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_databases (
  id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id    VARCHAR(63)  NOT NULL,
  state        ENUM('pending','active','retired') NOT NULL DEFAULT 'pending',
  -- una única BD activa por tenant
  active_flag  TINYINT(1) GENERATED ALWAYS AS (IF(state = 'active', 1, NULL)) STORED,
  dsn_cipher   TEXT         NOT NULL,
  key_id       VARCHAR(32)  NOT NULL,
  server_alias VARCHAR(64)  NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  rotated_at   TIMESTAMP(3) NULL,
  UNIQUE KEY uq_one_active_db_per_tenant (tenant_id, active_flag),
  KEY idx_databases_tenant (tenant_id),
  CONSTRAINT fk_databases_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_events (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id  VARCHAR(63)  NOT NULL,
  at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_type ENUM('system','operator','crm') NOT NULL,
  actor_id   VARCHAR(100) NOT NULL,
  action     VARCHAR(60)  NOT NULL,
  from_state VARCHAR(40)  NULL,
  to_state   VARCHAR(40)  NULL,
  details    JSON         NULL,
  request_id VARCHAR(64)  NULL,
  KEY idx_events_tenant_at (tenant_id, at),
  CONSTRAINT fk_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Auditoría inmutable: los eventos no se modifican ni se borran
DROP TRIGGER IF EXISTS trg_events_no_update;
DROP TRIGGER IF EXISTS trg_events_no_delete;
CREATE TRIGGER trg_events_no_update BEFORE UPDATE ON tenant_events
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tenant_events es de solo anexado';
CREATE TRIGGER trg_events_no_delete BEFORE DELETE ON tenant_events
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tenant_events es de solo anexado';
