-- ============================================================================
-- Registro de tenants — esquema v1.2.0: cuotas de recursos por tenant
--
-- Política (límites), no consumo: el consumo vive en la BD de métricas (db/erm).
-- El Core solo lee; las escrituras las hace el plano de control con auditoría.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenant_quotas (
  tenant_id   VARCHAR(63)  NOT NULL,
  metric      VARCHAR(64)  NOT NULL,
  period      ENUM('minute','hour','day','month') NOT NULL,
  limit_value BIGINT UNSIGNED NOT NULL,
  enforcement ENUM('hard','soft') NOT NULL DEFAULT 'hard',
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, metric, period),
  CONSTRAINT fk_quotas_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0002' WHERE k = 'schema_version';
