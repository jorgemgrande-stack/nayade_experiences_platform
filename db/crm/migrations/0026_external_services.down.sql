-- Reversión de 0026: borra la contratación de servicios externos, sus aceptaciones y su historial (Stripe conserva sus
-- objetos; los contratos del CRM no se tocan).
DROP TABLE IF EXISTS external_subscription_events;
DROP TABLE IF EXISTS crm_contract_acceptances;
DROP TABLE IF EXISTS external_subscriptions;
