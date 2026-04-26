UPDATE `system_settings` SET `value` = 'reservas@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_reservations' AND (`value` IS NULL OR `value` = '');
--> statement-breakpoint
UPDATE `system_settings` SET `value` = 'administracion@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_admin_alerts' AND (`value` IS NULL OR `value` = '');
--> statement-breakpoint
UPDATE `system_settings` SET `value` = 'administracion@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_accounting' AND (`value` IS NULL OR `value` = '');
--> statement-breakpoint
UPDATE `system_settings` SET `value` = 'reservas@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_cancellations' AND (`value` IS NULL OR `value` = '');
--> statement-breakpoint
UPDATE `system_settings` SET `value` = 'administracion@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_tpv_ingestion' AND (`value` IS NULL OR `value` = '');
--> statement-breakpoint
UPDATE `system_settings` SET `value` = 'noreply@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_noreply_sender' AND (`value` IS NULL OR `value` = '');
--> statement-breakpoint
UPDATE `system_settings` SET `value` = 'reservas@nayadeexperiences.es', `updated_at` = NOW() WHERE `key` = 'email_copy_recipient' AND (`value` IS NULL OR `value` = '');
