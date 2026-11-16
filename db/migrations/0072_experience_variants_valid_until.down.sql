-- Reversión de 0072: se retira la columna (las variantes caducadas vuelven a ofrecerse).
ALTER TABLE experience_variants DROP COLUMN validUntil;
