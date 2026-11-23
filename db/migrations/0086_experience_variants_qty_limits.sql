-- Límites de cantidad por opción (variante): «desde 2 participantes», «tarifa individual», etc. Aditiva, BD de cada empresa.
--
-- experience_variants.minQty / maxQty (INT, NULL = sin límite). El servidor rechaza la compra si el nº de participantes queda
-- fuera de ese rango. Las opciones existentes no cambian (NULL) y no se rellena ningún dato. Nunca se ejecuta al arrancar.

ALTER TABLE experience_variants ADD COLUMN minQty INT NULL;
ALTER TABLE experience_variants ADD COLUMN maxQty INT NULL;
