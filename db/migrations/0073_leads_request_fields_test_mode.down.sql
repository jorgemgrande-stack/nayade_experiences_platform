-- Reversión de 0073: se retiran las columnas (los datos van también en el texto de cada solicitud).
ALTER TABLE leads
  DROP COLUMN request_lang,
  DROP COLUMN variant_id,
  DROP COLUMN variant_label,
  DROP COLUMN shown_price,
  DROP COLUMN is_test;
