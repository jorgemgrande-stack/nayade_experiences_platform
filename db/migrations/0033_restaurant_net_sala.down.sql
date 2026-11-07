-- Reversión de 0033_restaurant_net_sala: se pierden las salas, mesas, carta, comandas y asignaciones de mesa a
-- reservas (las ventas ya cobradas siguen en el TPV con sus líneas, cobros y asientos). Antes, desplegar el código
-- anterior a este cambio.
ALTER TABLE restaurant_bookings
  DROP COLUMN hospo_order_id,
  DROP COLUMN seated_at;

DROP TABLE IF EXISTS restaurant_booking_tables;
DROP TABLE IF EXISTS hospo_order_items;
DROP TABLE IF EXISTS hospo_orders;
DROP TABLE IF EXISTS restaurant_menu_items;
DROP TABLE IF EXISTS dining_tables;
DROP TABLE IF EXISTS dining_rooms;
