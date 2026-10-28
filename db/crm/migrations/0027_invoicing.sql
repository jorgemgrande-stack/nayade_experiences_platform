-- Big Elephant — Facturación propia de Elephant Source (aditiva, base del CRM).
--
-- Facturas de lo que factura Big Elephant (IRON ELEPHANT CONSULTING, S.L.) a sus clientes, internos o externos. Se
-- factura por DEVENGO (fecha de operación), no por cobro: el estado de cobro va aparte y se actualiza con los hechos
-- de cobro que registra la parte de pagos. Contrato: docs/elephant-source/CONTRATO_COBROS_FACTURACION.md §5.
--
-- `invoice_series`: series de numeración (código, año y siguiente número). El número se asigna al EXPEDIR, en la
--   misma transacción, correlativo y sin huecos ni reutilización.
-- `invoices`: una por hecho facturable (`source_key` única por entorno: idempotencia, nunca dos facturas del mismo
--   hecho). Datos del emisor y del cliente CONGELADOS al expedir; importes en céntimos; huella encadenada por serie.
-- `invoice_lines`: líneas (concepto, periodo, cantidad, precio, base, tipo y cuota de IVA).
-- Sin estas tablas el plano de control funciona igual: la facturación propia no se monta.
--
-- irreversible: las facturas expedidas se conservan por obligación legal (art. 19 del RD 1619/2012 y art. 30 del Código
-- de Comercio); revertir el código no borra estas tablas. Si hiciera falta retirarlas, es una decisión documentada aparte.

CREATE TABLE invoice_series (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  code VARCHAR(16) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  next_number INT UNSIGNED NOT NULL DEFAULT 1,
  last_hash CHAR(64) NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_series (livemode, code, year)
);

CREATE TABLE invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  source_key VARCHAR(160) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  payment_status VARCHAR(16) NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  billing_ref VARCHAR(80) NOT NULL,
  payment_ref VARCHAR(120) NULL,
  original_invoice_id BIGINT UNSIGNED NULL,
  series_code VARCHAR(16) NULL,
  number VARCHAR(40) NULL,
  operation_date CHAR(10) NOT NULL,
  period_start BIGINT NULL,
  period_end BIGINT NULL,
  period_label VARCHAR(60) NULL,
  issue_date CHAR(10) NULL,
  currency CHAR(3) NOT NULL,
  base_cents INT NOT NULL,
  tax_cents INT NOT NULL,
  total_cents INT NOT NULL,
  issuer_json TEXT NULL,
  customer_json TEXT NULL,
  hash CHAR(64) NULL,
  previous_hash CHAR(64) NULL,
  notes VARCHAR(500) NULL,
  issued_at BIGINT NULL,
  issued_by VARCHAR(120) NULL,
  paid_at BIGINT NULL,
  created_by VARCHAR(120) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_source (livemode, source_key),
  UNIQUE KEY uq_invoice_number (livemode, number),
  KEY ix_invoice_company (livemode, company_id),
  KEY ix_invoice_status (livemode, status)
);

CREATE TABLE invoice_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id BIGINT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  concept VARCHAR(300) NOT NULL,
  quantity INT NOT NULL,
  unit_cents INT NOT NULL,
  base_cents INT NOT NULL,
  tax_rate_bp INT UNSIGNED NOT NULL,
  tax_cents INT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_line (invoice_id, position)
);
