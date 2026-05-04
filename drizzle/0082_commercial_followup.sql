-- Módulo Atención Comercial: Seguimiento de Presupuestos No Convertidos
-- Migración segura e idempotente — no modifica tablas existentes

CREATE TABLE IF NOT EXISTS `commercial_followup_settings` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `enabled` boolean NOT NULL DEFAULT true,
  `maxTotalRemindersPerQuote` int NOT NULL DEFAULT 3,
  `maxEmailsPerRun` int NOT NULL DEFAULT 50,
  `allowedSendStart` varchar(5) NOT NULL DEFAULT '09:00',
  `allowedSendEnd` varchar(5) NOT NULL DEFAULT '21:00',
  `timezone` varchar(50) NOT NULL DEFAULT 'Europe/Madrid',
  `stopAfterDays` int NOT NULL DEFAULT 30,
  `internalCcEmail` varchar(320),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `commercial_followup_rules` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `name` varchar(200) NOT NULL,
  `isActive` boolean NOT NULL DEFAULT true,
  `delayHours` int NOT NULL DEFAULT 24,
  `triggerFrom` enum('quote_sent_at','last_reminder_at') NOT NULL DEFAULT 'quote_sent_at',
  `onlyIfNotViewed` boolean NOT NULL DEFAULT false,
  `allowIfViewedButUnpaid` boolean NOT NULL DEFAULT true,
  `maxSendsPerQuoteForThisRule` int NOT NULL DEFAULT 1,
  `emailSubject` varchar(500) NOT NULL,
  `emailBody` text NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `quote_commercial_tracking` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `quoteId` int NOT NULL UNIQUE,
  `commercialStatus` enum('pending_followup','reminder_1_sent','reminder_2_sent','reminder_3_sent','interested','paused','lost','converted','discarded') NOT NULL DEFAULT 'pending_followup',
  `reminderPaused` boolean NOT NULL DEFAULT false,
  `reminderPausedReason` text,
  `reminderCount` int NOT NULL DEFAULT 0,
  `lastReminderAt` timestamp NULL,
  `nextFollowupAt` timestamp NULL,
  `lastContactAt` timestamp NULL,
  `lastContactChannel` enum('email','phone','whatsapp','internal') NULL,
  `lostReason` text,
  `internalNotes` text,
  `assignedToUserId` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `commercial_communications` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `quoteId` int NOT NULL,
  `customerEmail` varchar(320),
  `customerPhone` varchar(32),
  `type` enum('quote_sent','automatic_reminder','manual_reminder','payment_link_sent','internal_note','phone_call','whatsapp','lost_reason') NOT NULL,
  `channel` enum('email','phone','whatsapp','internal') NOT NULL DEFAULT 'email',
  `subject` varchar(500),
  `bodySnapshot` text,
  `ruleId` int NULL,
  `status` enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  `errorMessage` text,
  `sentByUserId` int NULL,
  `sentAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_comm_quoteId` (`quoteId`),
  INDEX `idx_comm_sentAt` (`sentAt`),
  UNIQUE KEY `uq_comm_quote_rule` (`quoteId`, `ruleId`, `type`)
);

-- Seed: configuración global por defecto (solo si no existe)
INSERT IGNORE INTO `commercial_followup_settings` (id, enabled) VALUES (1, true);

-- Seed: 3 reglas por defecto
INSERT IGNORE INTO `commercial_followup_rules` (id, name, isActive, delayHours, triggerFrom, onlyIfNotViewed, allowIfViewedButUnpaid, maxSendsPerQuoteForThisRule, emailSubject, emailBody, sortOrder)
VALUES
(1, 'Recordatorio 24h', true, 24, 'quote_sent_at', false, true, 1,
 '¿Te ayudamos a cerrar tu experiencia en Náyade?',
 'Hola {{clientName}},\n\nTe escribimos porque hace unas horas te enviamos tu propuesta para disfrutar de Náyade Experiences.\n\nSi tienes cualquier duda, podemos ayudarte a terminar la reserva o ajustar la experiencia a lo que necesitas.\n\nPuedes ver tu propuesta usando el botón de abajo.',
 1),
(2, 'Recordatorio 72h', true, 72, 'quote_sent_at', false, true, 1,
 'Tu propuesta de Náyade Experiences sigue disponible',
 'Hola {{clientName}},\n\nTu propuesta sigue activa, pero te recomendamos confirmarla cuanto antes para asegurar disponibilidad en la fecha seleccionada.\n\nPuedes revisarla y confirmar tu reserva desde aquí.',
 2),
(3, 'Última oportunidad (120h)', true, 120, 'quote_sent_at', false, true, 1,
 'Última llamada para confirmar tu experiencia',
 'Hola {{clientName}},\n\nQueríamos recordarte por última vez que tu propuesta sigue pendiente de confirmación.\n\nSi quieres mantener la fecha y disponibilidad, puedes revisarla desde aquí.',
 3);
