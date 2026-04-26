ALTER TABLE `fin_cash_closures` ADD COLUMN `source_entity_type` varchar(32);
--> statement-breakpoint
ALTER TABLE `fin_cash_closures` ADD COLUMN `source_entity_id` int;
--> statement-breakpoint
ALTER TABLE `fin_cash_closures` MODIFY COLUMN `status_fcc` enum('open','closed','reconciled','balanced','difference') NOT NULL DEFAULT 'open';
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
  `created_by` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `fin_cash_alerts_id` PRIMARY KEY(`id`)
);
