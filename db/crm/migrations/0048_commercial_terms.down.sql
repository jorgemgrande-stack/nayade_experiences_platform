-- Reversión de 0048: quita el enlace de las partidas con su acuerdo y las tablas de condiciones personalizadas.
-- Las partidas de suscripción conservan su importe unitario; se pierde el importe neto por periodo de las
-- materializadas desde una cuota global y todo el historial de acuerdos.
ALTER TABLE subscription_items DROP FOREIGN KEY fk_item_terms, DROP KEY idx_item_terms, DROP COLUMN line_amount_cents, DROP COLUMN terms_line_id, DROP COLUMN terms_id;
DROP TABLE IF EXISTS commercial_terms_events;
DROP TABLE IF EXISTS commercial_terms_adjustments;
DROP TABLE IF EXISTS commercial_terms_lines;
DROP TABLE IF EXISTS commercial_terms;
