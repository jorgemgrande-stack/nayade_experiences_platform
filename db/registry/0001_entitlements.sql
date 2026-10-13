-- ============================================================================
-- Registro de tenants — esquema v1.1.0: licencias (entitlements) de módulos
--
-- Hecho operativo («este tenant tiene derecho a este módulo hasta tal fecha»), no dato
-- comercial: precios, planes y facturación viven en Big Elephant CRM. El Core solo lee.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id   VARCHAR(63)  NOT NULL,
  module_id   VARCHAR(32)  NOT NULL,
  status      ENUM('active','suspended','expired') NOT NULL DEFAULT 'active',
  valid_until TIMESTAMP(3) NULL,
  source      ENUM('operator','crm') NOT NULL DEFAULT 'operator',
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, module_id),
  CONSTRAINT fk_entitlements_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_entitlement_module CHECK (REGEXP_LIKE(module_id, '^[a-z][a-z0-9_]{1,31}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0001' WHERE k = 'schema_version';
