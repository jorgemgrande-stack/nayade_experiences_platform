-- Fase 1 de la consolidación de motores de recordatorios.
--
-- Cambios:
-- 1. Apaga el feature flag del cron legacy quote_reminder_job — su lógica ya
--    está cubierta por commercialFollowupJob (y se migrará a emailAutomationJob
--    en Fase 3).
-- 2. Sanea el quote 89 (PRES-2026-0096), cuyos contadores quedaron desincronizados
--    por el bug del orden de envío en commercialFollowupJob (fix aplicado en
--    Fase 1, código). Real: 2 envíos en commercial_communications (id 9 y 14).
--    Se ajustan ambos contadores a 2 y se sincroniza el último envío manual.

UPDATE `feature_flags`
SET `enabled` = false
WHERE `key` = 'quote_reminder_job_enabled';
--> statement-breakpoint

UPDATE `quote_commercial_tracking`
SET `reminderCount` = 2,
    `lastReminderAt` = '2026-05-17 19:32:43',
    `commercialStatus` = 'reminder_2_sent',
    `updatedAt` = NOW()
WHERE `quoteId` = 89;
--> statement-breakpoint

UPDATE `quotes`
SET `reminderCount` = 2,
    `lastReminderAt` = '2026-05-17 19:32:43',
    `updatedAt` = NOW()
WHERE `id` = 89;
