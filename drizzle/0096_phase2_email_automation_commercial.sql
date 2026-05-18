-- Fase 2 de la consolidación de motores de recordatorios.
--
-- Prepara el motor centralizado (emailAutomationJob + email_automation_rules)
-- para asumir toda la lógica que hoy hace commercialFollowupJob. No migra reglas
-- todavía (eso es Fase 3) — solo añade el esqueleto que falta.
--
-- Cambios:
-- 1. email_automation_rules: añadir columnas que cubre commercial_followup_rules
--    pero no email_automation_rules.
-- 2. quote_internal_notes: nueva tabla para notas internas no-email (sustituye
--    a las filas type='internal_note' de commercial_communications, que se
--    eliminarán en Fase 5).

ALTER TABLE `email_automation_rules`
  ADD COLUMN `onlyIfNotViewed` boolean NOT NULL DEFAULT false,
  ADD COLUMN `allowIfViewedButUnpaid` boolean NOT NULL DEFAULT true,
  ADD COLUMN `maxCumulativeSendsPerEntity` int DEFAULT NULL,
  ADD COLUMN `stopAfterDays` int DEFAULT NULL,
  ADD COLUMN `respectCommercialPause` boolean NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE TABLE `quote_internal_notes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `quoteId` int NOT NULL,
  `channel` enum('email','phone','whatsapp','internal') NOT NULL DEFAULT 'internal',
  `body` text NOT NULL,
  `authorUserId` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `quote_internal_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

CREATE INDEX `idx_quote_internal_notes_quoteId` ON `quote_internal_notes` (`quoteId`);
