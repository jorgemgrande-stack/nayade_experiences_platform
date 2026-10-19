-- Reversión de 0018_stripe_subscription_changes: quita el registro de cambios de partidas enviados a Stripe.
-- Los pedidos, pagos y facturas no se tocan (el estado de cada cambio sigue en Stripe y en sus pedidos).
DROP TABLE stripe_subscription_changes;
