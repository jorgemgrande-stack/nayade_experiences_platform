-- Reversión de 0095 sin perder datos: las tablas se RENOMBRAN (se conservan las suscripciones y su consentimiento).
RENAME TABLE newsletter_subscribers TO retired_newsletter_subscribers,
             newsletter_events TO retired_newsletter_events,
             newsletter_mail_log TO retired_newsletter_mail_log,
             newsletter_exports TO retired_newsletter_exports,
             newsletter_settings TO retired_newsletter_settings;
