-- Reversión de 0006_subscriptions (se pierden las suscripciones, su historial y las simulaciones de facturación).
DROP TABLE IF EXISTS shadow_webhook_events;
DROP TABLE IF EXISTS shadow_charges;
DROP TABLE IF EXISTS shadow_invoices;
DROP TABLE IF EXISTS subscription_usage;
DROP TABLE IF EXISTS subscription_events;
DROP TABLE IF EXISTS subscription_items;
DROP TABLE IF EXISTS subscriptions;
