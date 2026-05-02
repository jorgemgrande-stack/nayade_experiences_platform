CREATE TABLE `card_terminal_batch_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`action` enum('match_suggested','match_auto_ready','match_no_candidate','match_review_required','suggestion_accepted','suggestion_rejected','auto_reconciled','manual_reconciled','unreconciled','review_flagged') NOT NULL,
	`bank_movement_id` int,
	`score` int,
	`auto_reconciled` boolean NOT NULL DEFAULT false,
	`performed_by` varchar(128),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `card_terminal_batch_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `config_change_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entity_type` enum('feature_flag','system_setting') NOT NULL,
	`key` varchar(128) NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_by_id` int,
	`changed_by_name` varchar(128),
	`changed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `config_change_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_email_ingestion_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message_id` varchar(512) NOT NULL,
	`subject` varchar(512),
	`sender` varchar(256),
	`received_at` timestamp,
	`status` enum('processed','duplicated','invalid_subject','missing_amount','error') NOT NULL,
	`expense_id` int,
	`amount_detected` decimal(12,2),
	`attachments_count` int DEFAULT 0,
	`error_message` text,
	`processed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_email_ingestion_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`module` varchar(64) NOT NULL DEFAULT 'general',
	`enabled` boolean NOT NULL DEFAULT true,
	`default_enabled` boolean NOT NULL DEFAULT true,
	`risk_level` enum('low','medium','high') NOT NULL DEFAULT 'low',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feature_flags_id` PRIMARY KEY(`id`),
	CONSTRAINT `feature_flags_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`type` enum('principal','secondary','petty_cash','other') NOT NULL DEFAULT 'principal',
	`current_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`initial_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fin_cash_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(64) NOT NULL DEFAULT 'cash_difference',
	`severity_fca` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
	`amount` decimal(12,2),
	`closure_id` int,
	`session_id` int,
	`message` text,
	`is_read` boolean NOT NULL DEFAULT false,
	`resolved_at` timestamp,
	`resolved_by` varchar(128),
	`resolution_notes` text,
	`resolution_action` varchar(64),
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fin_cash_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_closure_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`closure_id` int NOT NULL,
	`action_type_fcca` enum('review','adjustment_created','accepted_difference','note_added','alert_resolved') NOT NULL,
	`amount` decimal(12,2),
	`notes` text,
	`created_by_id` int,
	`created_by_name` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fin_cash_closure_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_closures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`opening_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total_income` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total_expenses` decimal(12,2) NOT NULL DEFAULT '0.00',
	`closing_balance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`counted_amount` decimal(12,2),
	`difference` decimal(12,2),
	`status_fcc` enum('open','closed','reconciled','balanced','difference','reviewed','adjusted','accepted_difference') NOT NULL DEFAULT 'open',
	`source_entity_type` varchar(32),
	`source_entity_id` int,
	`notes` text,
	`closed_by` int,
	`closed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fin_cash_closures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fin_cash_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`account_id` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`type_fcm` enum('income','expense','transfer_in','transfer_out','opening_balance','adjustment') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`concept` varchar(512) NOT NULL,
	`counterparty` varchar(256),
	`category` varchar(128),
	`related_entity_type` enum('reservation','expense','tpv_sale','bank_deposit','manual') DEFAULT 'manual',
	`related_entity_id` int,
	`transfer_to_account_id` int,
	`notes` text,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fin_cash_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onboarding_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organization_id` int NOT NULL,
	`business_info_completed` boolean NOT NULL DEFAULT false,
	`fiscal_completed` boolean NOT NULL DEFAULT false,
	`branding_completed` boolean NOT NULL DEFAULT false,
	`emails_completed` boolean NOT NULL DEFAULT false,
	`modules_completed` boolean NOT NULL DEFAULT false,
	`integrations_reviewed` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onboarding_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `onboarding_status_organization_id_unique` UNIQUE(`organization_id`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`slug` varchar(128) NOT NULL,
	`status` enum('active','inactive','onboarding') NOT NULL DEFAULT 'onboarding',
	`owner_user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `proposal_options` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proposalId` int NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text,
	`items` json DEFAULT ('[]'),
	`subtotal` decimal(10,2) NOT NULL DEFAULT '0',
	`discount` decimal(10,2) DEFAULT '0',
	`tax` decimal(10,2) DEFAULT '0',
	`total` decimal(10,2) NOT NULL DEFAULT '0',
	`isRecommended` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proposal_options_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proposalNumber` varchar(32) NOT NULL,
	`leadId` int NOT NULL,
	`agentId` int NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text,
	`mode` enum('configurable','multi_option') NOT NULL DEFAULT 'configurable',
	`items` json DEFAULT ('[]'),
	`subtotal` decimal(10,2) NOT NULL DEFAULT '0',
	`discount` decimal(10,2) DEFAULT '0',
	`tax` decimal(10,2) DEFAULT '0',
	`total` decimal(10,2) NOT NULL DEFAULT '0',
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`status` enum('borrador','enviado','visualizado','aceptado','rechazado','expirado') NOT NULL DEFAULT 'borrador',
	`token` varchar(128),
	`publicUrl` text,
	`validUntil` timestamp,
	`conditions` text,
	`notes` text,
	`sentAt` timestamp,
	`viewedAt` timestamp,
	`acceptedAt` timestamp,
	`selectedOptionId` int,
	`convertedToQuoteId` int,
	`ghlOpportunityId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `proposals_proposalNumber_unique` UNIQUE(`proposalNumber`),
	CONSTRAINT `proposals_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `rbac_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`module` varchar(64) NOT NULL,
	`action` varchar(128) NOT NULL,
	`description` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rbac_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `rbac_permissions_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `rbac_role_permissions` (
	`role_id` int NOT NULL,
	`permission_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `rbac_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`is_legacy` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rbac_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `rbac_roles_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `rbac_user_roles` (
	`user_id` int NOT NULL,
	`role_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text,
	`value_type` enum('string','number','boolean','json') NOT NULL DEFAULT 'string',
	`category` varchar(64) NOT NULL DEFAULT 'general',
	`label` varchar(256) NOT NULL,
	`description` text,
	`is_sensitive` boolean NOT NULL DEFAULT false,
	`is_public` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
ALTER TABLE `bank_movement_links` MODIFY COLUMN `entity_type` enum('quote','reservation','invoice','expense','card_terminal_batch','manual') NOT NULL;--> statement-breakpoint
ALTER TABLE `bank_movement_links` MODIFY COLUMN `link_type` enum('income_transfer','card_income','cash_income','expense_payment','manual_conciliation') NOT NULL DEFAULT 'income_transfer';--> statement-breakpoint
ALTER TABLE `card_terminal_batches` MODIFY COLUMN `status` enum('pending','suggested','auto_ready','reconciled','difference','ignored','review_required') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `expenses` MODIFY COLUMN `status` enum('pending','justified','accounted','conciliado') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `experiences` MODIFY COLUMN `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general';--> statement-breakpoint
ALTER TABLE `packs` MODIFY COLUMN `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general';--> statement-breakpoint
ALTER TABLE `room_types` MODIFY COLUMN `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general';--> statement-breakpoint
ALTER TABLE `spa_treatments` MODIFY COLUMN `fiscalRegime` enum('reav','general','mixed') NOT NULL DEFAULT 'general';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` MODIFY COLUMN `fiscalRegime_tsi` enum('reav','general','mixed') DEFAULT 'general';--> statement-breakpoint
ALTER TABLE `transactions` MODIFY COLUMN `fiscalRegime_tx` enum('reav','general','mixed') DEFAULT 'general';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest','controler') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD `suggested_bank_movement_id` int;--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD `suggested_score` int;--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD `matching_run_at` timestamp;--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD `suggestion_rejected` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `source` varchar(32) DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `expenses` ADD `emailMessageId` varchar(512);--> statement-breakpoint
ALTER TABLE `expenses` ADD `emailFrom` varchar(256);--> statement-breakpoint
ALTER TABLE `expenses` ADD `missingAttachment` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `experiences` ADD `taxRate` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `invoices` ADD `taxBreakdown` json;--> statement-breakpoint
ALTER TABLE `packs` ADD `taxRate` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `room_types` ADD `taxRate` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `taxRate` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `transactions` ADD `taxRate_tx` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `card_terminal_operations` ADD CONSTRAINT `card_terminal_operations_duplicate_key_unique` UNIQUE(`duplicate_key`);