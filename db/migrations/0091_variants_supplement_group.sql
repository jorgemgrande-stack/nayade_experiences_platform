-- Suplementos opcionales de un producto (p. ej. alimentación ayurvédica de los retiros). Aditiva, BD de cada empresa.
--
-- experience_variants.supplementGroup (VARCHAR 64, NULL). Si está informado, la fila NO es una opción del programa sino un
-- suplemento que la persona marca aparte; las filas con el mismo grupo son los tramos (minQty/maxQty) del mismo suplemento.
-- NULL = opción normal (todas las existentes). No se rellena ningún dato. Nunca se ejecuta al arrancar.

ALTER TABLE experience_variants ADD COLUMN supplementGroup VARCHAR(64) NULL;
