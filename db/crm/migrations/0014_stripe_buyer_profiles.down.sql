-- Reversión de 0014_stripe_buyer_profiles: se pierden los perfiles fiscales de los compradores y su historial
-- (incluido el registro de consentimiento). No toca pedidos, pagos, contratos ni objetos de Stripe.
-- En un entorno con contrataciones reales, exportar antes ambas tablas: el registro de consentimiento es
-- evidencia contractual. Antes, retirar CP_STRIPE_FISCAL_SCENARIOS del plano de control.
DROP TABLE IF EXISTS stripe_buyer_profile_events;
DROP TABLE IF EXISTS stripe_buyer_profiles;
