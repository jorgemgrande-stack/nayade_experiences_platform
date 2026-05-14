CREATE TABLE IF NOT EXISTS `commercial_communications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`customerEmail` varchar(320),
	`customerPhone` varchar(32),
	`type` enum('quote_sent','automatic_reminder','manual_reminder','payment_link_sent','internal_note','phone_call','whatsapp','lost_reason') NOT NULL,
	`channel` enum('email','phone','whatsapp','internal') NOT NULL DEFAULT 'email',
	`subject` varchar(500),
	`bodySnapshot` text,
	`ruleId` int,
	`status` enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
	`errorMessage` text,
	`sentByUserId` int,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commercial_communications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commercial_emails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`message_id` varchar(512) NOT NULL,
	`in_reply_to` varchar(512),
	`from_email` varchar(320) NOT NULL,
	`from_name` varchar(255),
	`to_emails` json NOT NULL,
	`cc_emails` json DEFAULT ('[]'),
	`subject` varchar(512) NOT NULL,
	`body_html` mediumtext,
	`body_text` mediumtext,
	`snippet` varchar(300),
	`sent_at` timestamp,
	`is_read` boolean NOT NULL DEFAULT false,
	`is_answered` boolean NOT NULL DEFAULT false,
	`is_archived` boolean NOT NULL DEFAULT false,
	`is_deleted` boolean NOT NULL DEFAULT false,
	`is_sent` boolean NOT NULL DEFAULT false,
	`folder` varchar(100) NOT NULL DEFAULT 'INBOX',
	`has_attachments` boolean NOT NULL DEFAULT false,
	`labels` json DEFAULT ('[]'),
	`assigned_user_id` int,
	`linked_lead_id` int,
	`linked_client_id` int,
	`linked_quote_id` int,
	`linked_reservation_id` int,
	`imap_uid` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commercial_emails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commercial_followup_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
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
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commercial_followup_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commercial_followup_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`maxTotalRemindersPerQuote` int NOT NULL DEFAULT 3,
	`maxEmailsPerRun` int NOT NULL DEFAULT 50,
	`allowedSendStart` varchar(5) NOT NULL DEFAULT '09:00',
	`allowedSendEnd` varchar(5) NOT NULL DEFAULT '21:00',
	`timezone` varchar(50) NOT NULL DEFAULT 'Europe/Madrid',
	`stopAfterDays` int NOT NULL DEFAULT 30,
	`internalCcEmail` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `commercial_followup_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `crm_lead_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`color` varchar(20),
	`icon` varchar(50),
	`sort_order` int DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crm_lead_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `crm_lead_sources_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `customer_email_prefs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`automationsPaused` boolean NOT NULL DEFAULT false,
	`pauseReason` text,
	`pausedAt` timestamp,
	`pausedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_email_prefs_id` PRIMARY KEY(`id`),
	CONSTRAINT `customer_email_prefs_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`email` varchar(320) NOT NULL,
	`imap_host` varchar(255) NOT NULL DEFAULT '',
	`imap_port` int NOT NULL DEFAULT 993,
	`imap_secure` boolean NOT NULL DEFAULT true,
	`imap_user` varchar(320) NOT NULL DEFAULT '',
	`imap_password_enc` text NOT NULL DEFAULT (''),
	`smtp_host` varchar(255) NOT NULL DEFAULT '',
	`smtp_port` int NOT NULL DEFAULT 587,
	`smtp_secure` boolean NOT NULL DEFAULT false,
	`smtp_user` varchar(320) NOT NULL DEFAULT '',
	`smtp_password_enc` text NOT NULL DEFAULT (''),
	`from_name` varchar(255) NOT NULL DEFAULT '',
	`from_email` varchar(320) NOT NULL DEFAULT '',
	`is_active` boolean NOT NULL DEFAULT true,
	`is_default` boolean NOT NULL DEFAULT false,
	`sync_enabled` boolean NOT NULL DEFAULT true,
	`sync_interval_min` int NOT NULL DEFAULT 5,
	`last_sync_at` timestamp,
	`last_sync_error` text,
	`folder_inbox` varchar(100) NOT NULL DEFAULT 'INBOX',
	`folder_sent` varchar(100) NOT NULL DEFAULT 'Sent',
	`folder_archive` varchar(100) NOT NULL DEFAULT 'Archive',
	`folder_trash` varchar(100) NOT NULL DEFAULT 'Trash',
	`max_emails_per_sync` int NOT NULL DEFAULT 50,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_automation_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`templateKey` varchar(128) NOT NULL,
	`name` varchar(256) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`delayHours` int NOT NULL DEFAULT 24,
	`calculateFrom` enum('trigger_time','last_reminder','created_at','viewed_at','expires_at') NOT NULL DEFAULT 'trigger_time',
	`conditionsJson` json,
	`maxSendsPerEntity` int NOT NULL DEFAULT 1,
	`allowedSendStart` varchar(5) NOT NULL DEFAULT '09:00',
	`allowedSendEnd` varchar(5) NOT NULL DEFAULT '21:00',
	`stopIfConverted` boolean NOT NULL DEFAULT true,
	`stopIfPaid` boolean NOT NULL DEFAULT true,
	`emailSubject` varchar(512),
	`emailBody` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_automation_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_comm_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int,
	`quoteId` int,
	`reservationId` int,
	`relatedEntityType` varchar(64),
	`relatedEntityId` int,
	`templateKey` varchar(128),
	`ruleId` int,
	`triggerEvent` varchar(128),
	`channel` varchar(32) NOT NULL DEFAULT 'email',
	`recipientEmail` varchar(320),
	`ccEmail` varchar(320),
	`subject` varchar(512),
	`status` enum('sent','failed','skipped') NOT NULL DEFAULT 'sent',
	`provider` varchar(32),
	`errorMessage` text,
	`sentByUserId` int,
	`isAutomatic` boolean NOT NULL DEFAULT false,
	`skipReason` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_comm_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_scheduled_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`relatedEntityType` varchar(64) NOT NULL,
	`relatedEntityId` int NOT NULL,
	`templateKey` varchar(128) NOT NULL,
	`ruleId` int NOT NULL,
	`recipientEmail` varchar(320),
	`scheduledFor` timestamp NOT NULL,
	`status` enum('pending','sent','skipped','failed','cancelled') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`errorMessage` text,
	`skipReason` varchar(256),
	`lockedAt` timestamp,
	`metadataJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_scheduled_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_template_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`category` varchar(64),
	`friendlyName` varchar(256),
	`isActive` boolean NOT NULL DEFAULT true,
	`sendToCustomer` boolean NOT NULL DEFAULT true,
	`sendToAdmin` boolean NOT NULL DEFAULT false,
	`adminCopyEmail` varchar(320),
	`customSubject` varchar(512),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_template_configs_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_template_configs_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ghl_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ghlConversationId` varchar(64) NOT NULL,
	`ghlContactId` varchar(64),
	`locationId` varchar(64),
	`channel` varchar(32) NOT NULL DEFAULT 'whatsapp',
	`customerName` varchar(255),
	`phone` varchar(32),
	`email` varchar(320),
	`lastMessagePreview` text,
	`lastMessageAt` timestamp,
	`unreadCount` int NOT NULL DEFAULT 0,
	`inbox` varchar(64),
	`starred` boolean NOT NULL DEFAULT false,
	`status` enum('new','open','pending','replied','closed') NOT NULL DEFAULT 'new',
	`assignedUserId` int,
	`linkedQuoteId` int,
	`linkedReservationId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ghl_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `ghl_conversations_ghlConversationId_unique` UNIQUE(`ghlConversationId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ghl_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ghlMessageId` varchar(64) NOT NULL,
	`ghlConversationId` varchar(64) NOT NULL,
	`direction` enum('inbound','outbound') NOT NULL DEFAULT 'inbound',
	`messageType` varchar(32) DEFAULT 'text',
	`body` text,
	`attachmentsJson` json,
	`senderName` varchar(255),
	`sentAt` timestamp,
	`deliveryStatus` varchar(32),
	`rawPayloadJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ghl_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `ghl_messages_ghlMessageId_unique` UNIQUE(`ghlMessageId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ghl_webhook_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` varchar(128),
	`eventType` varchar(128) NOT NULL,
	`ghlConversationId` varchar(64),
	`ghlContactId` varchar(64),
	`locationId` varchar(64),
	`rawPayloadJson` json,
	`processedStatus` enum('pending','processed','failed','ignored') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`processedAt` timestamp,
	CONSTRAINT `ghl_webhook_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `partner_billing_batch_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` int NOT NULL,
	`reservationId` int NOT NULL,
	`amount` decimal(10,2) NOT NULL DEFAULT '0',
	`description` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `partner_billing_batch_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `partner_billing_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchNumber` varchar(32) NOT NULL,
	`partnerId` int NOT NULL,
	`periodType` enum('weekly','biweekly','monthly','manual') NOT NULL DEFAULT 'monthly',
	`periodStart` varchar(10) NOT NULL,
	`periodEnd` varchar(10) NOT NULL,
	`totalAmount` decimal(12,2) NOT NULL DEFAULT '0',
	`status` enum('borrador','emitida','cobrada','anulada') NOT NULL DEFAULT 'borrador',
	`invoiceId` int,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partner_billing_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `partner_billing_batches_batchNumber_unique` UNIQUE(`batchNumber`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `partners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`fiscalName` varchar(256),
	`nif` varchar(32),
	`address` text,
	`city` varchar(128),
	`postalCode` varchar(16),
	`country` varchar(4) NOT NULL DEFAULT 'ES',
	`contactName` varchar(256),
	`contactEmail` varchar(320),
	`contactPhone` varchar(32),
	`billingEmail` varchar(320),
	`canCreateReservations` boolean NOT NULL DEFAULT false,
	`canCreateLeads` boolean NOT NULL DEFAULT true,
	`allowedReservationProductIds` json,
	`allowedLeadProductIds` json,
	`commissionType` enum('none','fixed_lead','fixed_reservation','percent','per_product','manual') NOT NULL DEFAULT 'none',
	`commissionValue` decimal(10,4),
	`billingEnabled` boolean NOT NULL DEFAULT false,
	`billingPeriod` enum('weekly','biweekly','monthly','manual') NOT NULL DEFAULT 'monthly',
	`monthlyQuota` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`notes` text,
	`announcements` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partners_id` PRIMARY KEY(`id`),
	CONSTRAINT `partners_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `quote_commercial_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`commercialStatus` enum('pending_followup','reminder_1_sent','reminder_2_sent','reminder_3_sent','interested','paused','lost','converted','discarded') NOT NULL DEFAULT 'pending_followup',
	`reminderPaused` boolean NOT NULL DEFAULT false,
	`reminderPausedReason` text,
	`reminderCount` int NOT NULL DEFAULT 0,
	`lastReminderAt` timestamp,
	`nextFollowupAt` timestamp,
	`lastContactAt` timestamp,
	`lastContactChannel` enum('email','phone','whatsapp','internal'),
	`lostReason` text,
	`internalNotes` text,
	`assignedToUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quote_commercial_tracking_id` PRIMARY KEY(`id`),
	CONSTRAINT `quote_commercial_tracking_quoteId_unique` UNIQUE(`quoteId`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vapi_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vapiCallId` varchar(128) NOT NULL,
	`assistantId` varchar(128),
	`phoneNumber` varchar(32),
	`customerName` varchar(255),
	`customerEmail` varchar(320),
	`startedAt` timestamp,
	`endedAt` timestamp,
	`durationSeconds` int,
	`status` varchar(64),
	`endedReason` varchar(128),
	`recordingUrl` text,
	`transcript` mediumtext,
	`summary` text,
	`structuredData` json,
	`rawPayload` json,
	`linkedLeadId` int,
	`linkedBudgetId` int,
	`linkedReservationId` int,
	`reviewed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vapi_calls_id` PRIMARY KEY(`id`),
	CONSTRAINT `vapi_calls_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
ALTER TABLE `invoices` MODIFY COLUMN `paymentMethod` enum('redsys','transferencia','efectivo','otro','tarjeta_fisica','tarjeta_redsys') DEFAULT 'redsys';--> statement-breakpoint
ALTER TABLE `quotes` MODIFY COLUMN `payment_method` enum('redsys','transferencia','efectivo','otro','tarjeta_fisica','tarjeta_redsys');--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `paymentMethod` enum('redsys','transferencia','efectivo','otro','tarjeta_fisica','tarjeta_redsys');--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `channel` enum('ONLINE_DIRECTO','ONLINE_ASISTIDO','VENTA_DELEGADA','TPV_FISICO','PARTNER','TICKETING','MANUAL','API','web','crm','telefono','email','otro','tpv','groupon') DEFAULT 'ONLINE_DIRECTO';--> statement-breakpoint
ALTER TABLE `reviews` MODIFY COLUMN `entityType` enum('hotel','spa','experience','pack','restaurant') NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` MODIFY COLUMN `paymentMethod` enum('tarjeta','transferencia','efectivo','link_pago','otro','tarjeta_fisica','tarjeta_redsys') DEFAULT 'tarjeta';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest','controler','partner_admin','partner_user') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `cancellation_requests` ADD COLUMN IF NOT EXISTS `ghl_contact_id` varchar(128);--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD COLUMN IF NOT EXISTS `ghlContactId` varchar(128);--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN IF NOT EXISTS `partnerId` int;--> statement-breakpoint
ALTER TABLE `invoices` ADD COLUMN IF NOT EXISTS `partnerBillingBatchId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `partnerId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `partnerUserId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `lead_source_id` int;--> statement-breakpoint
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `preferred_time` varchar(10);--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `partner_id` int;--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `partner_user_id` int;--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `fbp` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `fbc` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `client_ip_address` varchar(45);--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `client_user_agent` varchar(500);--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD COLUMN IF NOT EXISTS `is_manual` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD COLUMN IF NOT EXISTS `concept_text` varchar(500);--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `partnerId` int;
