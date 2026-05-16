-- Token público para que el cliente acceda a su reserva vía URL sin login.
-- DEFAULT con expresión MySQL 8.0.13+: el token se auto-genera en cada INSERT
-- si la aplicación no lo pasa explícitamente. Esto evita tocar los 12+ puntos
-- de inserción de reservations en el código.
ALTER TABLE `reservations`
  ADD COLUMN IF NOT EXISTS `public_token` varchar(128)
  DEFAULT (SHA2(CONCAT(UUID(), UUID(), RAND()), 256));
--> statement-breakpoint
-- Backfill: rellenar tokens en reservas existentes que aún tengan NULL
UPDATE `reservations`
SET `public_token` = SHA2(CONCAT(UUID(), UUID(), RAND(), id), 256)
WHERE `public_token` IS NULL;
