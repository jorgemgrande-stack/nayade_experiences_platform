-- Elephant Source — excepciones comerciales de cuota con caducidad (aditiva).
--   tenant_quota_exceptions: cuota concedida a una empresa por encima (o por debajo) de lo contratado, con motivo,
--     responsable, inicio y caducidad. La vigencia se resuelve por fecha en cada lectura: al caducar, el límite vuelve
--     solo al contractual (plan + ampliaciones), sin tareas programadas. Solo se guarda `active` o `revoked`; «programada»
--     y «caducada» se deducen de las fechas.
--     period = 'total' para las cuotas de negocio (usuarios, sedes, contactos…); minute/hour/day/month para las del
--     Resource Manager (correo, IA, exportaciones…). new_limit NULL = sin tope durante la excepción.
--   tenant_quota_exception_history: cada alta y revocación, con quién, cuándo y el detalle.
-- Nada se borra: una excepción revocada o caducada conserva su fila y su historial.
-- Reversión: 0016_quota_exceptions.down.sql (elimina las dos tablas y su historial: exportar antes si hay filas).

CREATE TABLE IF NOT EXISTS tenant_quota_exceptions (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id      VARCHAR(63)  NOT NULL,
  metric         VARCHAR(64)  NOT NULL,
  period         ENUM('total','minute','hour','day','month') NOT NULL DEFAULT 'total',
  original_limit BIGINT       NULL,
  new_limit      BIGINT       NULL,
  reason         VARCHAR(300) NOT NULL,
  operator       VARCHAR(100) NOT NULL,
  starts_at      BIGINT       NOT NULL,
  expires_at     BIGINT       NOT NULL,
  status         ENUM('active','revoked') NOT NULL DEFAULT 'active',
  revoked_at     BIGINT       NULL,
  revoked_by     VARCHAR(100) NULL,
  revoke_reason  VARCHAR(300) NULL,
  created_at     BIGINT       NOT NULL,
  updated_at     BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quota_exc_tenant_metric (tenant_id, metric, period, status),
  CONSTRAINT fk_quota_exc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT chk_quota_exc_dates CHECK (expires_at > starts_at),
  CONSTRAINT chk_quota_exc_limits CHECK ((new_limit IS NULL OR new_limit >= 0) AND (original_limit IS NULL OR original_limit >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_quota_exception_history (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  exception_id BIGINT       NOT NULL,
  tenant_id    VARCHAR(63)  NOT NULL,
  action       ENUM('created','revoked') NOT NULL,
  actor        VARCHAR(100) NOT NULL,
  at           BIGINT       NOT NULL,
  details      TEXT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_quota_exc_hist_tenant (tenant_id, at),
  KEY idx_quota_exc_hist_exception (exception_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- El marcador de versión (registry_meta) lo fija el aplicador tras verificar las tablas: sin UPDATE aquí.
