-- Reversión de 0013_stripe_livemode: la BD vuelve a admitir SOLO filas de pruebas (`CHECK (livemode = 0)` y
-- `commercial_payments.mode` solo 'test').
--
-- FALLA A PROPÓSITO si ya hay filas live, y lo hace en la PRIMERA comprobación, antes de cambiar nada: la
-- tabla auxiliar de abajo solo admite un recuento de filas live igual a 0 (además, MySQL comprobaría las
-- filas existentes al añadir cada CHECK y al reducir el ENUM). Es lo correcto: una BD con cobros reales no
-- se convierte en una de pruebas borrando o alterando esos datos. En el entorno live no se revierte; si de
-- verdad hiciera falta, primero hay que exportar y retirar a mano las filas live con su propio
-- procedimiento, nunca desde aquí. Antes, retirar CP_STRIPE_MODE=live del plano de control.
-- La tabla auxiliar no guarda datos: si la comprobación falla queda vacía y el siguiente intento la recrea.
--
-- Defensa adicional: modo SQL estricto en la sesión (reducir el ENUM nunca convierte en silencio un 'live'
-- en '') y el ENUM de commercial_payments se reduce el ÚLTIMO, después de los seis CHECK: si apareciera una
-- fila live entre la comprobación y los cambios, el primer CHECK que la encuentre detiene la reversión
-- antes de tocar los pagos.

SET SESSION sql_mode = CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES');

DROP TABLE IF EXISTS tmp_0013_live_rows;

CREATE TABLE tmp_0013_live_rows (live_rows INT NOT NULL, CONSTRAINT chk_tmp_0013_no_live_rows CHECK (live_rows = 0)) ENGINE=InnoDB;

INSERT INTO tmp_0013_live_rows (live_rows)
  SELECT (SELECT COUNT(*) FROM stripe_prices WHERE livemode <> 0)
       + (SELECT COUNT(*) FROM stripe_customers WHERE livemode <> 0)
       + (SELECT COUNT(*) FROM stripe_checkout_sessions WHERE livemode <> 0)
       + (SELECT COUNT(*) FROM stripe_subscriptions WHERE livemode <> 0)
       + (SELECT COUNT(*) FROM stripe_events WHERE livemode <> 0)
       + (SELECT COUNT(*) FROM stripe_charge_adjustments WHERE livemode <> 0)
       + (SELECT COUNT(*) FROM commercial_payments WHERE mode <> 'test');

DROP TABLE tmp_0013_live_rows;

ALTER TABLE stripe_charge_adjustments
  DROP CHECK chk_stripe_adj_livemode,
  ADD CONSTRAINT chk_stripe_adj_test CHECK (livemode = 0);

ALTER TABLE stripe_events
  DROP CHECK chk_stripe_event_livemode,
  ADD CONSTRAINT chk_stripe_event_test CHECK (livemode = 0);

ALTER TABLE stripe_subscriptions
  DROP CHECK chk_stripe_sub_livemode,
  ADD CONSTRAINT chk_stripe_sub_test CHECK (livemode = 0);

ALTER TABLE stripe_checkout_sessions
  DROP CHECK chk_stripe_checkout_livemode,
  ADD CONSTRAINT chk_stripe_checkout_test CHECK (livemode = 0);

ALTER TABLE stripe_customers
  DROP CHECK chk_stripe_customer_livemode,
  ADD CONSTRAINT chk_stripe_customer_test CHECK (livemode = 0);

ALTER TABLE stripe_prices
  DROP CHECK chk_stripe_price_livemode,
  ADD CONSTRAINT chk_stripe_price_test CHECK (livemode = 0);

ALTER TABLE commercial_payments
  MODIFY COLUMN mode ENUM('test') NOT NULL DEFAULT 'test';
