-- Reversión de 0016: elimina las excepciones comerciales de cuota y su historial.
-- Borra evidencia (quién concedió qué y por qué): exportar antes las dos tablas si tienen filas.
-- Sin las tablas, el Core y el plano de control vuelven a aplicar solo lo contractual (o el valor por defecto).

DROP TABLE IF EXISTS tenant_quota_exception_history;
DROP TABLE IF EXISTS tenant_quota_exceptions;

UPDATE registry_meta SET v = '0015' WHERE k = 'schema_version';
