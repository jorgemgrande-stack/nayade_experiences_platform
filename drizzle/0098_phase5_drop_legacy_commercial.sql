-- Fase 5: limpieza final tras consolidación de motores de recordatorios.
--
-- Migra el histórico que queda en commercial_communications a las tablas nuevas
-- (email_comm_log para emails, quote_internal_notes para notas no-email) y
-- después borra las tablas legacy que ya nadie usa.
--
-- ATENCIÓN: esta migración es destructiva. Las 3 tablas dropeadas no se pueden
-- recuperar. Asegúrate de que Fase 3-4 lleven al menos 1 semana estables antes
-- de aplicar.

-- ─── 1. Migrar emails históricos a email_comm_log ───────────────────────────
-- Tipos email: quote_sent, automatic_reminder, manual_reminder, payment_link_sent.
-- Solo migramos los que tienen quoteId, customerEmail y sentAt válidos.

INSERT INTO `email_comm_log`
  (`quoteId`, `relatedEntityType`, `relatedEntityId`,
   `templateKey`, `ruleId`, `triggerEvent`, `channel`,
   `recipientEmail`, `subject`, `status`, `provider`,
   `errorMessage`, `sentByUserId`, `isAutomatic`, `createdAt`)
SELECT
  cc.`quoteId`,
  'quote' AS relatedEntityType,
  cc.`quoteId` AS relatedEntityId,
  CASE
    WHEN cc.`type` = 'quote_sent' THEN 'quote'
    WHEN cc.`type` = 'automatic_reminder' THEN
      CONCAT('commercial_reminder_', LEAST(GREATEST(
        (SELECT COUNT(*) FROM `commercial_communications` cc2
         WHERE cc2.quoteId = cc.quoteId
         AND cc2.type IN ('automatic_reminder', 'manual_reminder')
         AND cc2.sentAt <= cc.sentAt), 1), 3))
    WHEN cc.`type` = 'manual_reminder' THEN
      CONCAT('commercial_reminder_', LEAST(GREATEST(
        (SELECT COUNT(*) FROM `commercial_communications` cc2
         WHERE cc2.quoteId = cc.quoteId
         AND cc2.type IN ('automatic_reminder', 'manual_reminder')
         AND cc2.sentAt <= cc.sentAt), 1), 3))
    WHEN cc.`type` = 'payment_link_sent' THEN 'payment_link'
    ELSE 'legacy'
  END AS templateKey,
  cc.`ruleId`,
  CONCAT('legacy_', cc.`type`) AS triggerEvent,
  cc.`channel`,
  cc.`customerEmail`,
  cc.`subject`,
  cc.`status`,
  'legacy_migration' AS provider,
  cc.`errorMessage`,
  cc.`sentByUserId`,
  CASE WHEN cc.`type` = 'automatic_reminder' THEN 1 ELSE 0 END AS isAutomatic,
  cc.`sentAt`
FROM `commercial_communications` cc
WHERE cc.`type` IN ('quote_sent', 'automatic_reminder', 'manual_reminder', 'payment_link_sent')
  AND cc.`customerEmail` IS NOT NULL;
--> statement-breakpoint

-- ─── 2. Migrar notas históricas no-email a quote_internal_notes ─────────────
-- Tipos nota: phone_call, whatsapp, lost_reason. (internal_note ya migrado en 0097)
INSERT INTO `quote_internal_notes` (`quoteId`, `channel`, `body`, `authorUserId`, `createdAt`)
SELECT
  cc.`quoteId`,
  CASE
    WHEN cc.`type` = 'phone_call' THEN 'phone'
    WHEN cc.`type` = 'whatsapp' THEN 'whatsapp'
    ELSE 'internal'
  END AS channel,
  CONCAT('[', cc.`type`, '] ', COALESCE(cc.`bodySnapshot`, cc.`subject`, '(sin contenido)')) AS body,
  cc.`sentByUserId` AS authorUserId,
  cc.`sentAt` AS createdAt
FROM `commercial_communications` cc
WHERE cc.`type` IN ('phone_call', 'whatsapp', 'lost_reason');
--> statement-breakpoint

-- ─── 3. DROP tablas legacy ──────────────────────────────────────────────────
DROP TABLE IF EXISTS `commercial_communications`;
--> statement-breakpoint
DROP TABLE IF EXISTS `commercial_followup_rules`;
--> statement-breakpoint
DROP TABLE IF EXISTS `commercial_followup_settings`;
--> statement-breakpoint

-- ─── 4. Limpiar feature flags muertos ───────────────────────────────────────
DELETE FROM `feature_flags`
WHERE `key` IN ('commercial_followup_job_enabled', 'quote_reminder_job_enabled');
