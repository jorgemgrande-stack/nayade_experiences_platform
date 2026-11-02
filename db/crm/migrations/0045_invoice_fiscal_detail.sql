-- Big Elephant — Facturación propia: datos fiscales de la factura y descuentos por línea (aditiva, base del CRM).
--
-- `invoices.fiscal_json`: tipo de factura (completa o simplificada), caso fiscal del comprador, tratamiento y mención
--   legal impresa, fecha del cobro, criterio de devengo, saldo a favor aplicado como forma de pago y los supuestos
--   pendientes de confirmar por la gestoría. NULL = sin datos fiscales (todo lo anterior y los servicios externos).
-- `invoice_lines.gross_cents` y `invoice_lines.discount_cents`: importe antes del descuento y descuento de la línea, sin
--   impuestos (base_cents = gross_cents − discount_cents). NULL = línea sin descuento, como hasta ahora.
-- El código comprueba que existan antes de usarlas: sin esta migración la facturación funciona exactamente igual.
--
-- irreversible: las facturas expedidas se conservan por obligación legal (art. 19 del RD 1619/2012); columnas nullable
-- que el código anterior no lee.
ALTER TABLE invoices
  ADD COLUMN fiscal_json TEXT NULL AFTER notes;

ALTER TABLE invoice_lines
  ADD COLUMN gross_cents INT NULL AFTER tax_cents,
  ADD COLUMN discount_cents INT NULL AFTER gross_cents;
