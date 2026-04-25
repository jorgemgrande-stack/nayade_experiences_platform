ALTER TABLE `card_terminal_batches` MODIFY COLUMN `status` enum('pending','suggested','auto_ready','reconciled','difference','ignored','review_required') NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD COLUMN `suggested_bank_movement_id` int;
--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD COLUMN `suggested_score` int;
--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD COLUMN `matching_run_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `card_terminal_batches` ADD COLUMN `suggestion_rejected` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `card_terminal_batch_audit_logs` (
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
