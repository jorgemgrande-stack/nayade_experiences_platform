-- Vuelta atrás de 0041: retira las operaciones externas y las columnas nuevas de las suscripciones externas.
DROP TABLE IF EXISTS external_operation_events;
DROP TABLE IF EXISTS external_operation_periods;
DROP TABLE IF EXISTS external_operations;
ALTER TABLE external_subscriptions
  DROP COLUMN adjustment_json,
  DROP COLUMN base_amount_cents,
  DROP COLUMN ends_at,
  DROP COLUMN duration_periods,
  DROP COLUMN interval_count;
