-- Reversión de 0080_payment_accounts.sql: elimina la cuenta vinculada, los eventos y las sesiones de cobro con Stripe
-- de la empresa. Exportar antes si hay filas (los pagos ya aplicados a presupuestos NO se tocan: viven en quotes/invoices).
DROP TABLE IF EXISTS payment_checkouts;
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS payment_accounts;
