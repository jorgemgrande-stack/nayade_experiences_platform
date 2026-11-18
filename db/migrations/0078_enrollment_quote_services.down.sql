-- Reversión de 0078: retira los servicios incluidos y el enlace de la inscripción con su presupuesto (las inscripciones,
-- los presupuestos y sus pagos no se tocan).
DROP TABLE IF EXISTS enrollment_services;
DROP TABLE IF EXISTS variant_included_services;

ALTER TABLE edition_enrollments
  DROP KEY idx_edition_enrollments_quote,
  DROP COLUMN quote_id,
  DROP COLUMN status_changed_by,
  DROP COLUMN status_changed_at,
  DROP COLUMN status_reason;
