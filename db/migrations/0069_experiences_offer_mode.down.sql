-- Reversión de 0069: quita las dos columnas (los productos vuelven a tratarse como de precio fijo).
ALTER TABLE experiences DROP COLUMN request_cta_label, DROP COLUMN offer_mode;
