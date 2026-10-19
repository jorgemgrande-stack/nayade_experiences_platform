-- Reversión de 0016_stripe_invoices_fiscal_documents: se pierden el registro local de facturas de Stripe y la
-- cola de documentos fiscales (con los números externos registrados). Stripe conserva sus facturas.
-- En un entorno con cobros reales, exportar antes ambas tablas: la cola enlaza cada cobro y cada reembolso con
-- su documento legal. Antes, desplegar una versión del plano de control que no las use.
DROP TABLE IF EXISTS fiscal_documents;
DROP TABLE IF EXISTS stripe_invoices;
