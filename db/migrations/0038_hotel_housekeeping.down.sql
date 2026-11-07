-- Reversión de 0038_hotel_housekeeping: se pierden las tareas de limpieza, las incidencias de habitación y sus tipos
-- (el estado operativo de las habitaciones y su historial se conservan). Antes, desplegar el código anterior a este
-- cambio.
DROP TABLE IF EXISTS hotel_room_incidents;
DROP TABLE IF EXISTS hotel_incident_types;
DROP TABLE IF EXISTS hotel_housekeeping_tasks;
