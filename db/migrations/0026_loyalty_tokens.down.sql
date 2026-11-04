-- Reversión de 0026_loyalty_tokens: se pierden el programa de puntos, los monederos, el libro de movimientos, las
-- reglas y las campañas. Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS loyalty_campaigns;
DROP TABLE IF EXISTS loyalty_rules;
DROP TABLE IF EXISTS loyalty_ledger;
DROP TABLE IF EXISTS loyalty_wallets;
DROP TABLE IF EXISTS loyalty_program;
