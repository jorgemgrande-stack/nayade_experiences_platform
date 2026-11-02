-- Reversión de 0023_pricing_rules: se pierden las reglas de precios de la empresa (los pedidos, ventas, presupuestos y
-- facturas ya creados conservan su precio guardado). Antes, desplegar el código anterior a las reglas de precios.
DROP TABLE IF EXISTS pricing_rules;
