-- Reversión de 0002_legacy_credential_audit (se pierde el registro de auditoría del cifrado; exportarlo antes si se necesita).
DROP TABLE IF EXISTS legacy_credential_audit;
