-- Big Elephant — Líneas de las facturas cobradas en Stripe (aditiva).
--
-- Cada línea de una factura registrada en `stripe_invoices` (0016): partida de la suscripción, Price, precio
-- aprobado y producto del catálogo, cantidad, base (negativa en un abono por prorrateo), impuesto, periodo, si es
-- prorrateo, y lo reembolsado asignado a esa línea. Así cada documento enlaza cliente, empresa, pedido,
-- suscripción, módulo, cantidad, periodo, base, impuestos, total, factura de Stripe, documento fiscal y reembolso.
--
-- Idempotente por línea de Stripe. No cambia ningún dato existente. Nunca se ejecuta al arrancar. `livemode` como
-- en 0012/0013. Trazabilidad: la fuente de verdad sigue siendo Stripe y la factura legal la emite el sistema de
-- facturación aprobado.

CREATE TABLE stripe_invoice_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  stripe_line_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  stripe_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  order_id INT NOT NULL,
  subscription_item_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  stripe_price_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  web_price_id INT NULL,
  product_key VARCHAR(64) NULL,
  quantity INT NULL,
  amount_cents INT NOT NULL,
  tax_cents INT NULL,
  proration TINYINT(1) NOT NULL DEFAULT 0,
  period_start BIGINT NULL,
  period_end BIGINT NULL,
  refunded_cents INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_invoice_line (stripe_line_id, livemode),
  KEY ix_invoice_line_invoice (stripe_invoice_id),
  KEY ix_invoice_line_order (order_id),
  CONSTRAINT fk_invoice_line_invoice FOREIGN KEY (stripe_invoice_id) REFERENCES stripe_invoices (stripe_invoice_id),
  CONSTRAINT fk_invoice_line_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_invoice_line_livemode CHECK (livemode IN (0,1)),
  -- Lo reembolsado de una línea nunca supera su importe con impuestos (ni es negativo)
  CONSTRAINT chk_invoice_line_refund CHECK (refunded_cents >= 0 AND refunded_cents <= GREATEST(amount_cents + COALESCE(tax_cents, 0), 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
