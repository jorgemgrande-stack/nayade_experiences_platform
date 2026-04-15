-- Cart checkout crea múltiples reservas con el mismo merchantOrder (un pago → N artículos).
-- El índice UNIQUE impide el segundo INSERT. Se elimina la restricción.
ALTER TABLE `reservations` DROP INDEX `reservations_merchant_order_unique`;
