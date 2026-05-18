-- Fase 3: switch-over al motor centralizado de recordatorios.
--
-- Cambios:
-- 1. Inserta 3 reglas en email_automation_rules (templateKey commercial_reminder_*)
--    réplica de las 3 reglas existentes en commercial_followup_rules.
-- 2. Migra notas internas (type='internal_note') a la tabla quote_internal_notes.
-- 3. Asegura el feature flag commercial_followup_job_enabled (puede no existir todavía).
-- 4. Apaga commercial_followup_job_enabled, enciende email_automation_job_enabled.
-- 5. Apaga commercialFollowupSettings.enabled (segunda compuerta del cron viejo).
-- 6. Desactiva (isActive=false) las 3 reglas en commercial_followup_rules como
--    red de seguridad (siguen ahí para Fase 5).
--
-- Tras esta migración: el único motor de envío activo es emailAutomationJob.

-- ─── 1. Reglas en email_automation_rules ────────────────────────────────────
-- Insertamos cada regla solo si no existe ya una con el mismo (templateKey, name).

INSERT INTO `email_automation_rules`
  (`templateKey`, `name`, `isActive`, `sortOrder`, `delayHours`, `calculateFrom`,
   `maxSendsPerEntity`, `allowedSendStart`, `allowedSendEnd`,
   `stopIfConverted`, `stopIfPaid`,
   `onlyIfNotViewed`, `allowIfViewedButUnpaid`, `maxCumulativeSendsPerEntity`,
   `stopAfterDays`, `respectCommercialPause`,
   `emailSubject`, `emailBody`)
SELECT
  'commercial_reminder_1', 'Recordatorio 24h', 1, 1, 24, 'trigger_time',
  1, '09:00', '21:00', 1, 1, 0, 1, 3, 30, 1,
  '¿Te ayudamos a cerrar tu experiencia en Náyade?',
  'Hola {{clientName}},\n\nTe escribimos porque hace unas horas te enviamos tu propuesta para disfrutar de Náyade Experiences.\n\nSi tienes cualquier duda, podemos ayudarte a terminar la reserva o ajustar la experiencia a lo que necesitas.'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `email_automation_rules`
  WHERE `templateKey` = 'commercial_reminder_1' AND `name` = 'Recordatorio 24h'
);
--> statement-breakpoint

INSERT INTO `email_automation_rules`
  (`templateKey`, `name`, `isActive`, `sortOrder`, `delayHours`, `calculateFrom`,
   `maxSendsPerEntity`, `allowedSendStart`, `allowedSendEnd`,
   `stopIfConverted`, `stopIfPaid`,
   `onlyIfNotViewed`, `allowIfViewedButUnpaid`, `maxCumulativeSendsPerEntity`,
   `stopAfterDays`, `respectCommercialPause`,
   `emailSubject`, `emailBody`)
SELECT
  'commercial_reminder_2', 'Recordatorio 72h', 1, 2, 72, 'trigger_time',
  1, '09:00', '21:00', 1, 1, 0, 1, 3, 30, 1,
  'Tu propuesta de Náyade Experiences sigue disponible',
  'Hola {{clientName}},\n\nTu propuesta sigue activa, pero te recomendamos confirmarla cuanto antes para asegurar disponibilidad en la fecha seleccionada.'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `email_automation_rules`
  WHERE `templateKey` = 'commercial_reminder_2' AND `name` = 'Recordatorio 72h'
);
--> statement-breakpoint

INSERT INTO `email_automation_rules`
  (`templateKey`, `name`, `isActive`, `sortOrder`, `delayHours`, `calculateFrom`,
   `maxSendsPerEntity`, `allowedSendStart`, `allowedSendEnd`,
   `stopIfConverted`, `stopIfPaid`,
   `onlyIfNotViewed`, `allowIfViewedButUnpaid`, `maxCumulativeSendsPerEntity`,
   `stopAfterDays`, `respectCommercialPause`,
   `emailSubject`, `emailBody`)
SELECT
  'commercial_reminder_3', 'Última oportunidad (120h)', 1, 3, 120, 'trigger_time',
  1, '09:00', '21:00', 1, 1, 0, 1, 3, 30, 1,
  'Última llamada para confirmar tu experiencia',
  'Hola {{clientName}},\n\nQueríamos recordarte por última vez que tu propuesta sigue pendiente de confirmación.'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM `email_automation_rules`
  WHERE `templateKey` = 'commercial_reminder_3' AND `name` = 'Última oportunidad (120h)'
);
--> statement-breakpoint

-- ─── 2. Migrar notas internas a quote_internal_notes ────────────────────────
INSERT INTO `quote_internal_notes` (`quoteId`, `channel`, `body`, `authorUserId`, `createdAt`)
SELECT
  `quoteId`,
  COALESCE(`channel`, 'internal') AS `channel`,
  COALESCE(`bodySnapshot`, `subject`, '(sin contenido)') AS `body`,
  `sentByUserId` AS `authorUserId`,
  `sentAt` AS `createdAt`
FROM `commercial_communications`
WHERE `type` = 'internal_note';
--> statement-breakpoint

-- ─── 3. Feature flag commercial_followup_job_enabled (idempotente) ──────────
INSERT IGNORE INTO `feature_flags`
  (`key`, `name`, `description`, `module`, `enabled`, `default_enabled`, `risk_level`)
VALUES
  ('commercial_followup_job_enabled',
   'Cron seguimiento comercial (legacy)',
   'Cron viejo de recordatorios comerciales — sustituido por email_automation_job en Fase 3',
   'crm', 0, 1, 'low');
--> statement-breakpoint

-- ─── 4. Toggle flags: encender el centralizado, apagar el comercial ────────
UPDATE `feature_flags` SET `enabled` = 1
WHERE `key` = 'email_automation_job_enabled';
--> statement-breakpoint

UPDATE `feature_flags` SET `enabled` = 0
WHERE `key` = 'commercial_followup_job_enabled';
--> statement-breakpoint

-- ─── 5. Segunda compuerta: apagar commercialFollowupSettings.enabled ────────
UPDATE `commercial_followup_settings` SET `enabled` = 0
WHERE `id` IS NOT NULL;
--> statement-breakpoint

-- ─── 6. Desactivar las 3 reglas legacy en commercial_followup_rules ─────────
UPDATE `commercial_followup_rules` SET `isActive` = 0
WHERE `name` IN ('Recordatorio 24h', 'Recordatorio 72h', 'Última oportunidad (120h)');
