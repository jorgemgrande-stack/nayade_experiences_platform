-- Reversión de 0098: se pierde qué variantes estaban retiradas y qué productos eran oferta permanente sin fecha
-- (vuelven al comportamiento anterior: todas las variantes visibles y fecha según el tipo de producto).
-- Retirar antes el código que usa estas columnas.
ALTER TABLE experiences DROP COLUMN service_date_mode;
ALTER TABLE experience_variants DROP COLUMN is_active;
