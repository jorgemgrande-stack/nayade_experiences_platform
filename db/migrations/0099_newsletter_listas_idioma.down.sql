-- Reversión de 0099. Retirar antes el código que usa estas columnas.
--  - Las campañas vuelven a ser solo por etiquetas (se pierde qué campañas eran por lista de newsletter).
--  - newsletter_imports se RENOMBRA (se conserva el registro de lotes).
--  - Los contactos históricos ('imported') no caben en el CHECK anterior: pasan a 'unsubscribed' con unsubscribed_by
--    'down:0099' (siguen sin recibir nada, que es la dirección segura; el lote queda en la tabla retirada).
--  - Se pierden signup_locale, locale_source, name, import_id e imported_at.
ALTER TABLE campaign_campaigns DROP COLUMN audience_kind;
ALTER TABLE campaign_campaigns DROP COLUMN newsletter_locale;
RENAME TABLE newsletter_imports TO retired_newsletter_imports;
ALTER TABLE newsletter_subscribers DROP CHECK chk_newsletter_subscribers_status_v2;
UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = (UNIX_TIMESTAMP(NOW(3)) * 1000), unsubscribed_by = 'down:0099' WHERE status = 'imported';
ALTER TABLE newsletter_subscribers ADD CONSTRAINT chk_newsletter_subscribers_status CHECK (status IN ('pending', 'active', 'unsubscribed'));
ALTER TABLE newsletter_subscribers DROP INDEX idx_newsletter_subscribers_locale;
ALTER TABLE newsletter_subscribers DROP COLUMN imported_at;
ALTER TABLE newsletter_subscribers DROP COLUMN import_id;
ALTER TABLE newsletter_subscribers DROP COLUMN name;
ALTER TABLE newsletter_subscribers DROP COLUMN locale_source;
ALTER TABLE newsletter_subscribers DROP COLUMN signup_locale;
