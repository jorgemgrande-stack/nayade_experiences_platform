-- Reversión de 0010_mail_outbox: se pierden la bandeja de salida, su historial y la lista de destinatarios
-- suprimidos de la empresa. Antes, dejar MAIL_MODE=off o retirar el código que la usa (server/mail/).
DROP TABLE IF EXISTS mail_suppressions;
DROP TABLE IF EXISTS mail_events;
DROP TABLE IF EXISTS mail_outbox;
