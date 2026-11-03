-- Reversión de 0017: elimina los datos de contacto de las sedes (las sedes de tenant_sites no cambian).
-- Exportar antes la tabla si tiene filas. Sin ella, el panel muestra las sedes sin dirección, teléfono ni correo.

DROP TABLE IF EXISTS tenant_site_details;

UPDATE registry_meta SET v = '0016' WHERE k = 'schema_version';
