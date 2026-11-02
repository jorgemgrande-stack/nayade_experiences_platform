-- Big Elephant — Finanzas corporativas: gastos automáticos de Stripe (aditiva, base del CRM).
--
-- Cada cargo real de Stripe (la comisión de cada cobro y cada servicio de Stripe: Billing, Radar…) es un gasto
-- registrado en `fin_expenses` con clave de origen `stripe-fee:<transacción de saldo>`. Stripe emite después una sola
-- factura mensual para muchos de esos gastos; el número de factura propio del gasto es único por proveedor, así que la
-- factura que los agrupa va en una columna aparte:
-- `fin_expenses.supplier_invoice_ref`: referencia de la factura del proveedor que justifica el gasto (NULL = sin
--   vincular). Ni el gasto ni su asiento se repiten al vincularla. Los gastos existentes quedan en NULL.
-- irreversible: columna nullable que el código anterior no lee; retirarla perdería los vínculos con las facturas de Stripe
ALTER TABLE fin_expenses
  ADD COLUMN supplier_invoice_ref VARCHAR(60) NULL AFTER invoice_number;
