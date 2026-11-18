-- Solicitud web completa: convocatoria y moneda en el lead, modalidad en la inscripción. Aditiva, BD de cada empresa.
--
-- leads.edition_id (convocatoria por la que se pidió plaza), leads.currency (moneda ISO 4217 del precio mostrado) y
-- edition_enrollments.variant_id (modalidad elegida en la ficha). Todas nullable y sin valor por defecto: los leads y las
-- inscripciones existentes no cambian. El código tolera que aún no esté aplicada (escribe y lee estas columnas aparte,
-- sin romper el alta de la solicitud). Nunca se ejecuta al arrancar.

ALTER TABLE leads
  ADD COLUMN edition_id INT NULL,
  ADD COLUMN currency CHAR(3) NULL;

ALTER TABLE edition_enrollments
  ADD COLUMN variant_id INT NULL;
