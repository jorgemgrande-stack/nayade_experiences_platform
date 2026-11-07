-- Reversión de 0043_hotel_huespedes: se pierden las fichas de huésped, su historial de estancias, la política de
-- conservación y los planes de tarifa (las reservas y sus importes se conservan). Antes, desplegar el código anterior
-- a este cambio.
DROP TABLE IF EXISTS hotel_rate_plans;
DROP TABLE IF EXISTS hotel_guest_settings;
DROP TABLE IF EXISTS hotel_stay_guests;
DROP TABLE IF EXISTS hotel_guests;
