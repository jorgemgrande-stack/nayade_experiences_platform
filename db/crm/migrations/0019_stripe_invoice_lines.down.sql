-- Reversión de 0019_stripe_invoice_lines: quita el detalle por línea de las facturas registradas. Las facturas
-- (stripe_invoices), los documentos fiscales y los cobros no se tocan; Stripe conserva sus líneas.
DROP TABLE stripe_invoice_lines;
