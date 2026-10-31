-- Big Elephant — enlace de precios con Stripe por modo (pruebas y live en la MISMA base).
-- 0012 hizo únicos `web_price_id` y `lookup_key` en toda la tabla y 0013 admitió filas live suponiendo una base
-- separada por modo. La base de production conserva los enlaces de pruebas de los mismos precios aprobados, así que
-- el enlace live (mismo precio de la web y misma lookup_key en la cuenta real) chocaba con ellos: `price_conflict`
-- y Checkout live sin precios. Las claves pasan a ser únicas POR MODO; `stripe_price_id` sigue siendo único (Stripe
-- no repite identificadores entre modos). No cambia ningún dato: las filas de pruebas siguen ahí y el código solo lee
-- las de su modo. La clave foránea de `web_price_id` queda cubierta por el índice compuesto nuevo (empieza por ella).
-- Nunca se ejecuta al arrancar.

ALTER TABLE stripe_prices
  ADD UNIQUE KEY uq_stripe_price_web_mode (web_price_id, livemode),
  ADD UNIQUE KEY uq_stripe_price_lookup_mode (lookup_key, livemode),
  DROP INDEX uq_stripe_price_web,
  DROP INDEX uq_stripe_price_lookup;
