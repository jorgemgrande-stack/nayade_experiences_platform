-- Big Elephant — Copia de los datos del emisor en cada factura, abono y ticket facturado (aditiva, BD de cada empresa).
--
-- `invoices.issuerSnapshot`: razón social, NIF, domicilio, contacto e IBAN del emisor, y la marca (nombre, logotipo, web
-- y colores), tal y como estaban al emitir el documento. Las facturas nuevas la guardan al emitirse y se pintan siempre
-- con ella, aunque la empresa cambie después sus datos. Las ya emitidas la dejan vacía (NULL): no se rellenan.
-- `invoice_issuer_baseline`: una sola fila con los ajustes fiscales y de marca de la empresa en el momento de aplicar
-- esta migración. Las facturas emitidas antes (sin copia) se siguen pintando con la fuente de antes, pero con estos
-- valores congelados, para que cambiar ahora los datos de la empresa no altere ninguna factura ya emitida.
--
-- Solo añade una columna nula, una tabla nueva y su fila inicial. Nunca se ejecuta al arrancar.

ALTER TABLE invoices
  ADD COLUMN issuerSnapshot JSON NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS invoice_issuer_baseline (
  id           TINYINT      NOT NULL,
  own_json     JSON         NULL DEFAULT NULL,
  legacy_json  JSON         NULL DEFAULT NULL,
  captured_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO invoice_issuer_baseline (id, own_json, legacy_json)
SELECT 1,
  (SELECT JSON_OBJECTAGG(`key`, COALESCE(value, '')) FROM system_settings
    WHERE `key` IN ('site_legal_name', 'brand_nif', 'brand_address', 'site_legal_city', 'site_legal_zip', 'site_legal_province', 'site_legal_email', 'site_legal_phone', 'site_legal_iban',
                  'brand_name', 'brand_short_name', 'brand_logo_url', 'brand_website_url')),
  (SELECT JSON_OBJECTAGG(`key`, COALESCE(value, '')) FROM site_settings
    WHERE `key` IN ('legalCompanyName', 'legalCompanyCif', 'legalCompanyAddress', 'legalCompanyCity', 'legalCompanyZip', 'legalCompanyProvince', 'legalCompanyEmail', 'legalCompanyPhone', 'legalCompanyIban'));
