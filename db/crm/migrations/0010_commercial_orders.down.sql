-- Reversión de 0010_commercial_orders (se pierden los pedidos, su historial y los pagos de prueba;
-- contratos, suscripciones y licencias no se tocan).
DROP TABLE IF EXISTS commercial_payment_events;
DROP TABLE IF EXISTS commercial_payments;
DROP TABLE IF EXISTS commercial_order_events;
DROP TABLE IF EXISTS commercial_orders;
