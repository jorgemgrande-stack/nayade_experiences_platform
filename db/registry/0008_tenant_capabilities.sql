-- Elephant Source — licencias por CAPACIDAD (catálogo comercial v1) por empresa y, opcionalmente, por
-- sede. Aditiva. La emite el plano de control (nunca el tenant) y la lee el Core en modo multi.
--
-- Estados operativos (no contratado = sin fila):
--   contracted     contratado, aún no activado
--   pending_setup  pendiente de configuración
--   active         activo
--   read_only      solo lectura (p. ej. prueba vencida): se consulta, no se opera
--   suspended      suspendido
--   cancelled      cancelado (la fila se conserva como historia; los datos del tenant no se tocan)

CREATE TABLE IF NOT EXISTS tenant_capabilities (
  tenant_id     VARCHAR(63) NOT NULL,
  capability_id VARCHAR(63) NOT NULL,
  -- '' = toda la empresa; si no, el identificador de la sede
  site_id       VARCHAR(63) NOT NULL DEFAULT '',
  status        ENUM('contracted','pending_setup','active','read_only','suspended','cancelled') NOT NULL,
  -- ms desde epoch; NULL = sin caducidad
  valid_until   BIGINT NULL,
  -- Origen: subscription:<id> | trial:<id> | operator
  source        VARCHAR(80) NOT NULL,
  updated_at    BIGINT NOT NULL,
  updated_by    VARCHAR(100) NOT NULL,
  PRIMARY KEY (tenant_id, capability_id, site_id),
  CONSTRAINT fk_capabilities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_capability_id CHECK (REGEXP_LIKE(capability_id, '^[a-z0-9][a-z0-9-]{0,62}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historial de solo anexado de cada cambio de estado
CREATE TABLE IF NOT EXISTS tenant_capability_events (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     VARCHAR(63) NOT NULL,
  capability_id VARCHAR(63) NOT NULL,
  site_id       VARCHAR(63) NOT NULL DEFAULT '',
  from_status   VARCHAR(20) NULL,
  to_status     VARCHAR(20) NOT NULL,
  source        VARCHAR(80) NOT NULL,
  actor         VARCHAR(100) NOT NULL,
  reason        VARCHAR(300) NULL,
  at            BIGINT NOT NULL,
  KEY idx_capability_event (tenant_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0008' WHERE k = 'schema_version';
