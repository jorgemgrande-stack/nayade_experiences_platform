-- Reversión de 0035_restaurant_kds: se pierden las partidas, el enrutado por categoría, el semáforo y las incidencias
-- de cocina (las comandas, sus líneas, estados y tiempos se conservan). Antes, desplegar el código anterior a este
-- cambio.
DROP TABLE IF EXISTS hospo_kitchen_incidents;
DROP TABLE IF EXISTS hospo_kds_settings;
DROP TABLE IF EXISTS hospo_station_routing;
DROP TABLE IF EXISTS hospo_kitchen_stations;
