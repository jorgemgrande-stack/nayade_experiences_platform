-- Reversión de 0011_platform_mail_outbox: se pierden la bandeja de salida de plataforma, su historial y las
-- supresiones. Antes, dejar MAIL_MODE=off en el plano de control.
DROP TABLE IF EXISTS mail_suppressions;
DROP TABLE IF EXISTS mail_events;
DROP TABLE IF EXISTS mail_outbox;
