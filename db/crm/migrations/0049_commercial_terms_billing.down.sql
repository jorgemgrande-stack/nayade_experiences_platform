-- Reversión de 0049: quita el registro del cobro en Stripe de las condiciones personalizadas. Se pierde qué
-- suscripciones se pusieron a cobrar, su enlace con Stripe y el registro de sus facturas (Stripe los conserva).
DROP TABLE IF EXISTS commercial_terms_billing_invoices;
DROP TABLE IF EXISTS commercial_terms_billing;
