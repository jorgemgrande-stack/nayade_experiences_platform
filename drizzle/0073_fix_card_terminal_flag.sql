-- Ensure card_terminal_matching_enabled feature flag exists in DB.
-- Migration 0072 included this INSERT IGNORE but was already registered
-- in __drizzle_migrations before the INSERT was added to the file,
-- so the flag row was never created in the production DB.
INSERT IGNORE INTO `feature_flags` (`key`, `name`, `description`, `module`, `enabled`, `default_enabled`, `risk_level`) VALUES
  ('card_terminal_matching_enabled',
   'Job conciliación datáfono',
   'Ejecuta el job periódico que concilia batches de datáfono con movimientos bancarios',
   'card_terminal', true, true, 'medium');
