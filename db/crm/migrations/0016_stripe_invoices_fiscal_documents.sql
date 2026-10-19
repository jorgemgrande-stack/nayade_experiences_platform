-- Big Elephant — Registro de facturas de Stripe y cola de documentos fiscales (aditiva).
--
--  - `stripe_invoices`: copia de cada factura COBRADA en Stripe (identificador, número, importes base,
--    impuesto, total y reembolsado, motivo, periodo, dirección facturada y escenario fiscal del comprador). Es
--    trazabilidad: la fuente de verdad sigue siendo Stripe y la factura legal la decide DF-2.
--  - `fiscal_documents`: cola de documentos que el sistema de facturación legal aprobado debe emitir: una
--    factura por cada cobro y una rectificativa por cada reembolso (importe negativo, ligada al documento
--    original). Clave de origen única: un cobro o un reembolso nunca generan dos documentos. Aquí NO se emite
--    nada: quedan `pending` hasta que el sistema legal los registre (`issued`, con su número externo).
--
-- No cambia ningún dato existente. Nunca se ejecuta al arrancar. `livemode` como en 0012/0013.
-- Diseño: server/stripe/fiscalDocuments.ts y docs/elephant-source/FACTURACION_LIVE_DECISIONES.md §5.

CREATE TABLE stripe_invoices (
  stripe_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  order_id INT NOT NULL,
  stripe_customer_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  stripe_subscription_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  number VARCHAR(64) NULL,
  status ENUM('draft','open','paid','uncollectible','void') NOT NULL,
  billing_reason VARCHAR(40) NULL,
  purpose ENUM('initial','renewal','change') NOT NULL,
  currency CHAR(3) NOT NULL,
  subtotal_cents INT NOT NULL,
  tax_cents INT NULL,
  total_cents INT NOT NULL,
  amount_paid_cents INT NOT NULL,
  amount_refunded_cents INT NOT NULL DEFAULT 0,
  period_start BIGINT NULL,
  customer_country CHAR(2) NULL,
  customer_postal_code VARCHAR(12) NULL,
  buyer_scenario VARCHAR(32) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY ix_stripe_invoice_order (order_id),
  CONSTRAINT fk_stripe_invoice_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_stripe_invoice_livemode CHECK (livemode IN (0,1)),
  CONSTRAINT chk_stripe_invoice_amounts CHECK (subtotal_cents >= 0 AND total_cents >= 0 AND amount_paid_cents >= 0 AND amount_refunded_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fiscal_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  kind ENUM('invoice','rectification') NOT NULL,
  -- `invoice:<in_…>` o `refund:<ch_…>:<total reembolsado>`: idempotencia (nunca dos documentos del mismo hecho)
  source_key VARCHAR(160) NOT NULL,
  order_id INT NOT NULL,
  stripe_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  stripe_charge_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  original_document_id INT NULL,
  currency CHAR(3) NOT NULL,
  base_cents INT NOT NULL,
  tax_cents INT NULL,
  total_cents INT NOT NULL,
  status ENUM('pending','issued','failed') NOT NULL DEFAULT 'pending',
  -- Número o referencia del documento en el sistema de facturación legal (al emitirse)
  external_ref VARCHAR(80) NULL,
  issued_at BIGINT NULL,
  issued_by VARCHAR(120) NULL,
  last_error VARCHAR(300) NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_fiscal_document_source (source_key, livemode),
  KEY ix_fiscal_document_status (status, livemode),
  CONSTRAINT fk_fiscal_document_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT fk_fiscal_document_original FOREIGN KEY (original_document_id) REFERENCES fiscal_documents (id),
  CONSTRAINT chk_fiscal_document_livemode CHECK (livemode IN (0,1)),
  -- Factura: importes positivos y sin original. Rectificativa: importe negativo y ligada a su original
  CONSTRAINT chk_fiscal_document_sign CHECK ((kind = 'invoice' AND total_cents >= 0 AND original_document_id IS NULL) OR (kind = 'rectification' AND total_cents < 0)),
  CONSTRAINT chk_fiscal_document_issued CHECK (status <> 'issued' OR (external_ref IS NOT NULL AND issued_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
