-- Petición de fechas en productos «bajo petición» (sin convocatoria). Aditiva, BD de cada empresa.
--
-- experiences.duration_days        duración como DATO (días); NULL = no consta (nunca se deduce de un texto como «6 Tage»).
-- experiences.request_dates_from   primer día en que se admiten peticiones de fecha de inicio; NULL = desde mañana.
-- experiences.request_dates_until  último día admitido; NULL = el producto NO muestra calendario de peticiones (como hasta ahora).
--
-- No se rellena ningún dato: los productos existentes no cambian de comportamiento. Nunca se ejecuta al arrancar.
ALTER TABLE experiences ADD COLUMN duration_days INT NULL;
ALTER TABLE experiences ADD COLUMN request_dates_from DATE NULL;
ALTER TABLE experiences ADD COLUMN request_dates_until DATE NULL;
