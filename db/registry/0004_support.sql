-- ============================================================================
-- Registro de tenants — esquema v1.4.0: concesiones de soporte delegado
--
-- Acceso temporal y auditado de un operador a UN tenant. El Core solo lee.
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_grants (
  id         CHAR(32)     NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(63)  NOT NULL,
  operator   VARCHAR(100) NOT NULL,
  reason     VARCHAR(300) NOT NULL,
  read_only  TINYINT(1)   NOT NULL DEFAULT 1,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at TIMESTAMP(3) NULL,
  KEY idx_support_tenant (tenant_id, expires_at),
  CONSTRAINT fk_support_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0004' WHERE k = 'schema_version';
