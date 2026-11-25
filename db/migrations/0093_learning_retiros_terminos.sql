-- Retiros sin convocatoria: derecho de acceso desde un presupuesto PAGADO y duración contratada confirmada. Aditiva.
--
-- learning_access_rules.min_contracted_days: la regla solo concede si la duración CONTRATADA confirmada es de al menos estos días
--   (p. ej. 6 para el Módulo 1 de los retiros). NULL = sin condición (opciones de duración fija, como «6 Tage»).
-- quote_access_terms: duración contratada confirmada por la administración para un presupuesto (opciones de duración variable,
--   como «5–6 Tage»). Sin esta confirmación, esas reservas nunca generan el derecho de forma automática.
-- No se rellena ningún dato. Nunca se ejecuta al arrancar.

ALTER TABLE learning_access_rules ADD COLUMN min_contracted_days INT NULL;

CREATE TABLE IF NOT EXISTS quote_access_terms (
  quote_id INT NOT NULL PRIMARY KEY,
  contracted_days INT NOT NULL,
  reason VARCHAR(255) NULL,
  confirmed_by INT NULL,
  confirmed_at BIGINT NOT NULL
);
