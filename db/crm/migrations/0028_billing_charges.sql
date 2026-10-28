-- Big Elephant — Cargos extraordinarios y gastos variables por empresa (aditiva, base del CRM).
--
-- Lo que se cobra fuera de la cuota pactada: un cargo extraordinario (concepto libre) o un gasto variable repercutido
-- (coste de un proveedor + margen pactado, calculado en el servidor). Lo prepara y aprueba administración; al aprobarse
-- nace su factura por devengo (`invoices.source_key = charge:<id>`). El cobro lo ejecuta la parte de pagos (contrato
-- docs/elephant-source/CONTRATO_COBROS_FACTURACION.md, I-4): aquí solo queda el método y la autorización.
-- Sin esta tabla el plano de control funciona igual: los cargos no se montan.
--
-- irreversible: es un registro contable (cargos aprobados y sus facturas) que se conserva por obligación legal (art. 30
-- del Código de Comercio); revertir el código no borra la tabla.

CREATE TABLE billing_charges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  company_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(20) NOT NULL,
  status VARCHAR(16) NOT NULL,
  agreement_ref VARCHAR(80) NULL,
  billing_ref VARCHAR(80) NULL,
  concept VARCHAR(200) NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_cents INT NOT NULL,
  tax_rate_bp INT UNSIGNED NOT NULL,
  due_date CHAR(10) NOT NULL,
  method VARCHAR(16) NOT NULL,
  mandate_ref VARCHAR(120) NULL,
  detail_json TEXT NULL,
  invoice_id BIGINT UNSIGNED NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  reason VARCHAR(300) NULL,
  created_by VARCHAR(120) NOT NULL,
  created_at BIGINT NOT NULL,
  decided_by VARCHAR(120) NULL,
  decided_at BIGINT NULL,
  updated_at BIGINT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_charge_idem (livemode, idempotency_key),
  KEY ix_billing_charge_company (livemode, company_id),
  KEY ix_billing_charge_status (livemode, status)
);
