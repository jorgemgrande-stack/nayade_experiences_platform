-- Elephant Source — sedes y entidades fiscales de cada empresa cliente (aditiva).
--   Empresa cliente (tenant) = titular de la cuenta SaaS
--   Sede                     = unidad operativa (las licencias pueden ser por sede: tenant_capabilities.site_id)
--   Entidad fiscal           = sociedad o persona que emite los documentos fiscales
-- Nada se borra: se archiva (los documentos fiscales y el historial deben conservarse).

CREATE TABLE IF NOT EXISTS tenant_fiscal_entities (
  tenant_id   VARCHAR(63)  NOT NULL,
  entity_id   VARCHAR(63)  NOT NULL,
  legal_name  VARCHAR(200) NOT NULL,
  tax_id      VARCHAR(32)  NOT NULL,
  country     CHAR(2)      NOT NULL DEFAULT 'ES',
  address     VARCHAR(300) NULL,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  status      ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at  BIGINT       NOT NULL,
  created_by  VARCHAR(100) NOT NULL,
  updated_at  BIGINT       NOT NULL,
  PRIMARY KEY (tenant_id, entity_id),
  UNIQUE KEY uq_fiscal_tax_id (tenant_id, tax_id),
  CONSTRAINT fk_fiscal_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_fiscal_entity_id CHECK (REGEXP_LIKE(entity_id, '^[a-z0-9][a-z0-9-]{0,62}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_sites (
  tenant_id        VARCHAR(63)  NOT NULL,
  site_id          VARCHAR(63)  NOT NULL,
  name             VARCHAR(160) NOT NULL,
  fiscal_entity_id VARCHAR(63)  NULL,
  status           ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at       BIGINT       NOT NULL,
  created_by       VARCHAR(100) NOT NULL,
  updated_at       BIGINT       NOT NULL,
  PRIMARY KEY (tenant_id, site_id),
  CONSTRAINT fk_site_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_site_fiscal FOREIGN KEY (tenant_id, fiscal_entity_id) REFERENCES tenant_fiscal_entities (tenant_id, entity_id),
  CONSTRAINT chk_site_id CHECK (REGEXP_LIKE(site_id, '^[a-z0-9][a-z0-9-]{0,62}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0009' WHERE k = 'schema_version';
