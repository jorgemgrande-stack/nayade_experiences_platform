-- Big Elephant — Nuevas modalidades de servicios externos (aditiva).
--
-- `external_subscriptions` (0026) admite ahora periodicidad trimestral y anual, duración fija, ajuste comercial
--   autorizado (descuento o recargo) y borradores. Las filas existentes quedan exactamente igual: mensual, sin
--   duración ni ajuste (los valores por defecto de las columnas nuevas).
-- `external_operations`: cobros únicos (nota de cobro con desglose) e infraestructura recurrente (conceptos fijos o
--   variables con límites de consumo) de clientes externos. Nunca aprovisionan nada en Elephant Core.
-- `external_operation_periods`: cada emisión (el periodo «unico» de un cobro único o un mes de infraestructura), con
--   su cargo y su factura de la facturación propia (billing_charges, 0028). Un periodo por operación y mes.
-- `external_operation_events`: historial y trazabilidad (ajustes, emisiones, envíos y cobros), sin duplicados por ref.

ALTER TABLE external_subscriptions
  ADD COLUMN interval_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN duration_periods SMALLINT UNSIGNED NULL,
  ADD COLUMN ends_at BIGINT NULL,
  ADD COLUMN base_amount_cents INT UNSIGNED NULL,
  ADD COLUMN adjustment_json JSON NULL;

CREATE TABLE external_operations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  company_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  title VARCHAR(200) NOT NULL,
  currency CHAR(3) NOT NULL,
  tax_rate_bp INT UNSIGNED NOT NULL,
  lines_json JSON NOT NULL,
  adjustment_json JSON NULL,
  due_date VARCHAR(10) NULL,
  billing_day TINYINT UNSIGNED NULL,
  due_days TINYINT UNSIGNED NULL,
  start_period VARCHAR(7) NULL,
  cap_cents INT UNSIGNED NULL,
  recipient_name VARCHAR(160) NULL,
  recipient_email VARCHAR(254) NULL,
  notes VARCHAR(2000) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ext_op_company (company_id),
  KEY ix_ext_op_status (status),
  CONSTRAINT ck_ext_op_livemode CHECK (livemode IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE external_operation_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  period VARCHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL,
  lines_json JSON NOT NULL,
  usage_json JSON NULL,
  base_cents INT NOT NULL,
  adjustment_cents INT NOT NULL,
  net_cents INT NOT NULL,
  tax_cents INT NOT NULL,
  total_cents INT NOT NULL,
  due_date VARCHAR(10) NOT NULL,
  over_cap TINYINT(1) NOT NULL DEFAULT 0,
  over_cap_json JSON NULL,
  charge_id BIGINT UNSIGNED NULL,
  invoice_id BIGINT UNSIGNED NULL,
  sent_at BIGINT NULL,
  sent_to VARCHAR(254) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ext_op_period (operation_id, period),
  UNIQUE KEY uq_ext_op_period_charge (charge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE external_operation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(40) NOT NULL,
  ref VARCHAR(100) NULL,
  detail_json JSON NULL,
  actor VARCHAR(100) NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ext_op_event_ref (operation_id, kind, ref),
  KEY ix_ext_op_event (operation_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
