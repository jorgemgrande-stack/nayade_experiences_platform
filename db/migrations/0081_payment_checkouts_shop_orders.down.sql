-- Reversión de 0081: vuelve payment_checkouts a su forma de 0080. Las sesiones de pedidos de la tienda (kind =
-- 'shop_order') se eliminan antes porque no tienen presupuesto; los pedidos y sus pagos NO se tocan (viven en
-- reservations, invoices y transactions). Exportar antes la tabla si se quiere conservar la traza de esas sesiones.
DELETE FROM payment_checkouts WHERE kind = 'shop_order';
ALTER TABLE payment_checkouts
  DROP CONSTRAINT chk_payment_checkouts_kind,
  DROP KEY idx_payment_checkouts_order,
  DROP COLUMN merchant_order,
  DROP COLUMN kind,
  MODIFY COLUMN quote_id INT NOT NULL;
