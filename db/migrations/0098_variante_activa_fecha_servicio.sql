-- Oferta permanente de compra directa (Quantum Soulrise, decisión del 27/11/2026).
--  - experience_variants.is_active: la empresa retira una opción de precio sin borrarla ni caducarla
--    (p. ej. los Einführungspreise 10/14 o Lifetime 43). Por defecto 1: todas las variantes existentes siguen activas.
--  - experiences.service_date_mode: 'auto' (comportamiento de siempre: según el tipo de producto y la capacidad de
--    reservas), 'none' (oferta permanente: no se pide fecha de servicio) o 'required' (fecha libre obligatoria).
-- Aditiva: columnas con valor por defecto al final de la tabla (INSTANT en MySQL 8). No cambia ningún dato existente.
ALTER TABLE experience_variants ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE experiences ADD COLUMN service_date_mode VARCHAR(16) NOT NULL DEFAULT 'auto';
