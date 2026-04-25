CREATE TABLE IF NOT EXISTS `email_ingestion_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message_id` varchar(512) NOT NULL,
	`subject` varchar(512),
	`sender` varchar(255),
	`received_at` timestamp,
	`status` enum('ok','error','skipped') NOT NULL DEFAULT 'ok',
	`operations_inserted` int NOT NULL DEFAULT 0,
	`operations_duplicate` int NOT NULL DEFAULT 0,
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_ingestion_logs_id` PRIMARY KEY(`id`)
);
