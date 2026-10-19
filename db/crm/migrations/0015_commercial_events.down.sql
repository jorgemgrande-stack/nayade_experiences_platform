-- Reversión de 0015_commercial_events: se pierde el registro de eventos comerciales. Pedidos, pagos,
-- pruebas, suscripciones, ajustes de Stripe y sus historiales propios no se tocan (siguen siendo la
-- fuente de verdad). El código sin la tabla no registra eventos y sigue funcionando.
DROP TABLE IF EXISTS commercial_events;
