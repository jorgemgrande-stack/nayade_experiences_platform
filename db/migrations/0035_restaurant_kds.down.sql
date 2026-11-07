-- Reversión de 0035_restaurant_kds: se pierden las partidas, el enrutado por categoría, el semáforo y las incidencias
-- de cocina (las comandas, sus líneas, estados y tiempos se conservan). Antes, desplegar el código anterior a este
-- cambio.
ALTER TABLE hospo_orders
  DROP INDEX idx_hospo_orders_waiter;

ALTER TABLE hospo_order_items
  DROP INDEX idx_hospo_order_items_station,
  DROP INDEX idx_hospo_order_items_fired;

DROP TABLE IF EXISTS hospo_kitchen_incidents;
DROP TABLE IF EXISTS hospo_kds_settings;
DROP TABLE IF EXISTS hospo_station_routing;
DROP TABLE IF EXISTS hospo_kitchen_stations;
