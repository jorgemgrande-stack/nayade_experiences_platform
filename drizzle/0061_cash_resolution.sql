ALTER TABLE `fin_cash_closures` MODIFY COLUMN `status_fcc` enum('open','closed','reconciled','balanced','difference','reviewed','adjusted','accepted_difference') NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE `fin_cash_alerts`
  ADD COLUMN `resolved_at` timestamp NULL,
  ADD COLUMN `resolved_by` varchar(128) NULL,
  ADD COLUMN `resolution_notes` text NULL,
  ADD COLUMN `resolution_action` varchar(64) NULL;
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
