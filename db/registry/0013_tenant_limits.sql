-- Elephant Source — límites contratados y uso declarado de cada empresa (aditiva).
--   tenant_entitlement_limits: límites vigentes por métrica (usuarios, sedes, almacenamiento en GB) que escribe
--     el plano de control al aplicar las licencias: lo incluido en el plan + las ampliaciones contratadas.
--     limit_value NULL = sin tope técnico (por contrato). Sin fila, la empresa aplica lo incluido en su plan.
--   tenant_usage: uso real que declara la propia empresa (usuarios con plaza, bytes almacenados) para que el
--     plano de control no permita bajar una ampliación por debajo de lo usado (no accede a los datos).
-- Nada se borra: una empresa que vuelve a lo incluido conserva su fila con el límite nuevo.

CREATE TABLE IF NOT EXISTS tenant_entitlement_limits (
  tenant_id   VARCHAR(63)  NOT NULL,
  metric      ENUM('users','sites','storage_gb') NOT NULL,
  limit_value INT          NULL,
  source      VARCHAR(80)  NOT NULL,
  updated_at  BIGINT       NOT NULL,
  updated_by  VARCHAR(100) NOT NULL,
  PRIMARY KEY (tenant_id, metric),
  CONSTRAINT chk_limit_value CHECK (limit_value IS NULL OR limit_value >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_usage (
  tenant_id   VARCHAR(63)  NOT NULL,
  metric      ENUM('users','sites','storage_bytes') NOT NULL,
  used        BIGINT       NOT NULL,
  measured_at BIGINT       NOT NULL,
  PRIMARY KEY (tenant_id, metric),
  CONSTRAINT chk_usage_used CHECK (used >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0013' WHERE k = 'schema_version';
