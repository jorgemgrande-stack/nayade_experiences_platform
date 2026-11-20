-- Reversión de 0082_reservations_variant_id.sql: elimina la variante guardada en las líneas de pedido. Las matrículas ya
-- concedidas NO se tocan (guardan su propio variant_id en learning_enrollments).
ALTER TABLE reservations
  DROP COLUMN variant_id;
