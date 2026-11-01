-- Reversión de 0019_client_notes: se pierden las notas de las fichas de cliente (los datos del cliente, sus
-- observaciones y su historial se conservan). Antes, desplegar el código anterior a las notas de la ficha.
DROP TABLE IF EXISTS client_notes;
