-- Reversión de 0095 sin perder datos: las tablas se RENOMBRAN (se conservan las suscripciones y su consentimiento).
-- Antes se quitan sus restricciones CHECK (el nombre de una CHECK es único en toda la base y bloquearía volver a aplicar la 0095);
-- quitar una restricción no borra ninguna fila.
ALTER TABLE newsletter_subscribers DROP CHECK chk_newsletter_subscribers_status;
ALTER TABLE newsletter_settings DROP CHECK chk_newsletter_settings_singleton;
RENAME TABLE newsletter_subscribers TO retired_newsletter_subscribers,
             newsletter_events TO retired_newsletter_events,
             newsletter_mail_log TO retired_newsletter_mail_log,
             newsletter_exports TO retired_newsletter_exports,
             newsletter_settings TO retired_newsletter_settings;
