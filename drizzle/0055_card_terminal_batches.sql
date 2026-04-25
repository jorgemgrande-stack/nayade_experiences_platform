CREATE TABLE IF NOT EXISTS `card_terminal_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_date` varchar(12) NOT NULL,
	`commerce_code` varchar(64),
	`terminal_code` varchar(64),
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`total_sales` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total_refunds` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total_net` decimal(12,2) NOT NULL DEFAULT '0.00',
	`operation_count` int NOT NULL DEFAULT 0,
	`linked_operations_count` int NOT NULL DEFAULT 0,
	`status` enum('pending','suggested_bank_match','reconciled','difference','ignored') NOT NULL DEFAULT 'pending',
	`bank_movement_id` int,
	`reconciled_at` timestamp NULL,
	`reconciled_by` varchar(128),
	`difference_amount` decimal(12,2),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `card_terminal_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `card_terminal_batch_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`card_terminal_operation_id` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`operation_type` enum('VENTA','DEVOLUCION','ANULACION','OTRO') NOT NULL DEFAULT 'VENTA',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `card_terminal_batch_operations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `card_terminal_operations` MODIFY COLUMN `status` enum('pendiente','conciliado','incidencia','ignorado','included_in_batch','settled') NOT NULL DEFAULT 'pendiente';
--> statement-breakpoint
ALTER TABLE `bank_movement_links` MODIFY COLUMN `entity_type` enum('quote','reservation','invoice','expense','card_terminal_batch') NOT NULL;
