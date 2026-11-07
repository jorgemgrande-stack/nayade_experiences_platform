-- Reversión de 0032_hotel_pms: se pierden las habitaciones físicas, su historial de estados, las asignaciones de
-- habitación a reserva y las restricciones de estancia (las reservas y los bloqueos de inventario se conservan).
-- Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS hotel_stay_restrictions;
DROP TABLE IF EXISTS hotel_room_assignments;
DROP TABLE IF EXISTS hotel_room_state_events;
DROP TABLE IF EXISTS hotel_rooms;
