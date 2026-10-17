-- Reversión de 0009_stored_objects: se pierden los metadatos de los ficheros (los objetos del bucket NO
-- se borran). Antes, desactivar el servicio (STORAGE_OBJECTS=off) para que no se escriban más filas.
DROP TABLE IF EXISTS stored_objects;
