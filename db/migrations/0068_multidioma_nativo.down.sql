DROP TABLE IF EXISTS content_translations;
DROP TABLE IF EXISTS page_translations;
DROP TABLE IF EXISTS site_locales;
DELETE FROM system_settings WHERE `key` IN ('i18n_default_prefix', 'i18n_fallback', 'i18n_negotiate');
