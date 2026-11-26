-- Reversión de 0094 sin perder datos: la tabla se RENOMBRA (se conserva quién estaba identificado en cada reserva).
RENAME TABLE quote_participants TO retired_quote_participants;
