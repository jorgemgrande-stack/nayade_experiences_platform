-- Reversión de 0027_loyalty_rewards: se pierden el catálogo de recompensas, los canjes y el registro de validaciones
-- (los movimientos «canje» del libro de puntos se conservan). Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS loyalty_redemption_checks;
DROP TABLE IF EXISTS loyalty_redemptions;
DROP TABLE IF EXISTS loyalty_rewards;
