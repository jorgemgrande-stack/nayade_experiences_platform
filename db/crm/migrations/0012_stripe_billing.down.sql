-- Reversión de 0012_stripe_billing: se pierde la correspondencia local con Stripe (precios, clientes,
-- sesiones, suscripciones y eventos). Stripe conserva sus objetos y se pueden volver a enlazar con
-- la conciliación. No toca pedidos, contratos, suscripciones contractuales ni licencias.
-- Antes, retirar CP_STRIPE_* del plano de control.
DROP TABLE IF EXISTS stripe_sync_state;
DROP TABLE IF EXISTS stripe_events;
DROP TABLE IF EXISTS stripe_subscriptions;
DROP TABLE IF EXISTS stripe_checkout_sessions;
DROP TABLE IF EXISTS stripe_customers;
DROP TABLE IF EXISTS stripe_prices;
