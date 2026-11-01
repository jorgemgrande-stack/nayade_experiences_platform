-- Reversión de 0020_invoice_issuer_snapshot: las facturas pierden su copia del emisor y se vuelven a pintar con los
-- ajustes en vigor. Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS invoice_issuer_baseline;

ALTER TABLE invoices
  DROP COLUMN issuerSnapshot;
