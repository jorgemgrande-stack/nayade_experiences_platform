-- Reversión de 0018: elimina el índice global de cuentas de cobro. Las vinculaciones de cada empresa (payment_accounts
-- en su base, migración 0080) NO se tocan. Exportar antes la tabla si tiene filas: sin ella el webhook de cuentas
-- conectadas no puede resolver la empresa de una cuenta y ignora sus eventos.

DROP TABLE IF EXISTS tenant_payment_accounts;

UPDATE registry_meta SET v = '0017' WHERE k = 'schema_version';
