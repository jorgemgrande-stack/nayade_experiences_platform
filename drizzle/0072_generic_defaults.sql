-- ─── Feature flag for card terminal matching job (introduced in cleanup fase-c) ─
INSERT IGNORE INTO `feature_flags` (`key`, `name`, `description`, `module`, `enabled`, `default_enabled`, `risk_level`) VALUES
  ('card_terminal_matching_enabled',
   'Job conciliación datáfono',
   'Ejecuta el job periódico que concilia batches de datáfono con movimientos bancarios',
   'card_terminal', true, true, 'medium');
--> statement-breakpoint

-- ─── Remove deployment-specific email addresses from descriptions ─────────────
-- These description strings referenced nayadeexperiences.es addresses as
-- "fallback" examples. The code now falls back via EMAIL_FALLBACKS in config.ts,
-- so the descriptions should be generic.
UPDATE `system_settings` SET
  `description` = 'Dirección de correo para notificaciones de reservas'
  WHERE `key` = 'email_reservations';
--> statement-breakpoint
UPDATE `system_settings` SET
  `description` = 'Dirección de correo para alertas de administración'
  WHERE `key` = 'email_admin_alerts';
--> statement-breakpoint
UPDATE `system_settings` SET
  `description` = 'Dirección de correo para notificaciones contables'
  WHERE `key` = 'email_accounting';
--> statement-breakpoint
UPDATE `system_settings` SET
  `description` = 'Dirección de correo para notificaciones de cancelaciones'
  WHERE `key` = 'email_cancellations';
--> statement-breakpoint
UPDATE `system_settings` SET
  `description` = 'Dirección de correo monitoreada para ingesta de emails del datáfono'
  WHERE `key` = 'email_tpv_ingestion';
--> statement-breakpoint
UPDATE `system_settings` SET
  `description` = 'Dirección de remitente para emails transaccionales'
  WHERE `key` = 'email_noreply_sender';
--> statement-breakpoint
UPDATE `system_settings` SET
  `description` = 'Dirección que recibe copia de todas las reservas'
  WHERE `key` = 'email_copy_recipient';
--> statement-breakpoint

-- ─── Clear IMAP settings that reference Nayade-specific infrastructure ─────────
-- These were seeded with Nayade's mail server. A fresh deployment should
-- configure its own IMAP credentials. Safe to clear: the email ingestion job
-- reads from env vars (IMAP_TPV_HOST / IMAP_TPV_USER) at runtime.
UPDATE `system_settings` SET `value` = ''
  WHERE `key` = 'imap_host'
    AND `value` = 'nayadeexperiences.es.correoseguro.dinaserver.com';
--> statement-breakpoint
UPDATE `system_settings` SET `value` = ''
  WHERE `key` = 'imap_user'
    AND `value` = 'administracion@nayadeexperiences.es';
