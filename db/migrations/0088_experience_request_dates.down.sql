-- Reversión de 0088_experience_request_dates.sql: quita solo esas tres columnas (los productos vuelven a no admitir petición de fechas).
ALTER TABLE experiences DROP COLUMN request_dates_until;
ALTER TABLE experiences DROP COLUMN request_dates_from;
ALTER TABLE experiences DROP COLUMN duration_days;
