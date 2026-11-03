-- Reversión de 0025_inventory: se pierden las existencias, el historial de movimientos y la variante elegida en los
-- pedidos de la tienda. Antes, desplegar el código anterior a este cambio.
ALTER TABLE reservations
  DROP COLUMN stock_variant_id;

DROP TABLE IF EXISTS inventory_movements;
DROP TABLE IF EXISTS inventory_levels;
DROP TABLE IF EXISTS inventory_items;
