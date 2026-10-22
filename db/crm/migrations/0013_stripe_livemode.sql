-- Big Elephant — Stripe Billing en modo live (aditiva). Hasta ahora la BD solo admitía filas de pruebas
-- (`CHECK (livemode = 0)` en las tablas de 0012 y `commercial_payments.mode` solo 'test' en 0010). Esta
-- migración admite también filas live para desplegar el MISMO código en un entorno separado (`live`, con
-- su propia base de datos) contra la cuenta real de Stripe:
--  - las seis tablas `stripe_*` con datos de Stripe pasan a `CHECK (livemode IN (0,1))`
--  - `commercial_payments.mode` pasa a ENUM('test','live')
--
-- No cambia ningún dato: las filas existentes siguen siendo de pruebas. El código escribe `livemode` según
-- CP_STRIPE_MODE e ignora las filas del otro modo: un entorno nunca usa las del otro. La política fiscal y
-- el resto de protecciones del modo live viven en el código (server/stripe/config.ts y checkout.ts).
--
-- Requiere MySQL 8.0.19 o posterior (DROP CHECK). Nunca se ejecuta al arrancar.
-- Diseño: docs/elephant-source/STRIPE_PRODUCCION.md (sección «Modo live»).

ALTER TABLE stripe_prices
  DROP CHECK chk_stripe_price_test,
  ADD CONSTRAINT chk_stripe_price_livemode CHECK (livemode IN (0,1));

ALTER TABLE stripe_customers
  DROP CHECK chk_stripe_customer_test,
  ADD CONSTRAINT chk_stripe_customer_livemode CHECK (livemode IN (0,1));

ALTER TABLE stripe_checkout_sessions
  DROP CHECK chk_stripe_checkout_test,
  ADD CONSTRAINT chk_stripe_checkout_livemode CHECK (livemode IN (0,1));

ALTER TABLE stripe_subscriptions
  DROP CHECK chk_stripe_sub_test,
  ADD CONSTRAINT chk_stripe_sub_livemode CHECK (livemode IN (0,1));

ALTER TABLE stripe_events
  DROP CHECK chk_stripe_event_test,
  ADD CONSTRAINT chk_stripe_event_livemode CHECK (livemode IN (0,1));

ALTER TABLE stripe_charge_adjustments
  DROP CHECK chk_stripe_adj_test,
  ADD CONSTRAINT chk_stripe_adj_livemode CHECK (livemode IN (0,1));

ALTER TABLE commercial_payments
  MODIFY COLUMN mode ENUM('test','live') NOT NULL DEFAULT 'test';
