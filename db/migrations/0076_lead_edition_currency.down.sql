-- Reversión de 0076: se retiran las columnas (la convocatoria y la modalidad constan también en el texto de cada solicitud).
ALTER TABLE leads
  DROP COLUMN edition_id,
  DROP COLUMN currency;

ALTER TABLE edition_enrollments
  DROP COLUMN variant_id;
