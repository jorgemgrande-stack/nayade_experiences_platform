-- Vigencia de una variante (precio u opción): último día en que se ofrece. Aditiva, BD de cada empresa.
--
-- experience_variants.validUntil (DATE, NULL = sin caducidad). Pasado ese día (hora de Europe/Madrid) la variante deja de
-- ofrecerse en la web y no puede añadirse a un pedido; el administrador la sigue viendo. Sin tareas programadas: la
-- comparación se hace al consultar. Las variantes existentes no cambian (NULL). Nunca se ejecuta al arrancar.

ALTER TABLE experience_variants ADD COLUMN validUntil DATE NULL;
