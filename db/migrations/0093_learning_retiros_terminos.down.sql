-- Reversión de 0093 sin perder datos: se quita la columna de la regla y la tabla de duraciones se RENOMBRA (se conserva lo confirmado).
ALTER TABLE learning_access_rules DROP COLUMN min_contracted_days;
RENAME TABLE quote_access_terms TO retired_quote_access_terms;
