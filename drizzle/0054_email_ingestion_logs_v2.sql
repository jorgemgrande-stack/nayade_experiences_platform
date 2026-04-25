ALTER TABLE `email_ingestion_logs` ADD COLUMN `parsing_strategy` varchar(16);
--> statement-breakpoint
ALTER TABLE `email_ingestion_logs` ADD COLUMN `operations_detected` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `email_ingestion_logs` ADD COLUMN `operations_linked` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `email_ingestion_logs` ADD COLUMN `operations_failed` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `email_ingestion_logs` ADD COLUMN `retry_count` int NOT NULL DEFAULT 0;
