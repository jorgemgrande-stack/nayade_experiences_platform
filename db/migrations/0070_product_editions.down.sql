-- Reversión de 0070: borra las convocatorias y sus inscripciones (las oportunidades del CRM no se tocan).
DROP TABLE IF EXISTS edition_enrollments;
DROP TABLE IF EXISTS product_editions;
