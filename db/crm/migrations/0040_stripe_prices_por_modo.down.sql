-- Vuelta atrás de 0040: claves únicas globales otra vez. Falla (y no cambia nada) si ya hay un precio enlazado en
-- los dos modos: antes hay que retirar a mano el enlace de uno de ellos.

ALTER TABLE stripe_prices
  ADD UNIQUE KEY uq_stripe_price_web (web_price_id),
  ADD UNIQUE KEY uq_stripe_price_lookup (lookup_key),
  DROP INDEX uq_stripe_price_web_mode,
  DROP INDEX uq_stripe_price_lookup_mode;
