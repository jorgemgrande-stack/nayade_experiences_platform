CREATE TABLE IF NOT EXISTS `card_terminal_operations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`operation_datetime` timestamp NOT NULL,
	`operation_number` varchar(64) NOT NULL,
	`commerce_code` varchar(64),
	`terminal_code` varchar(64),
	`operation_type` enum('VENTA','DEVOLUCION','ANULACION','OTRO') NOT NULL DEFAULT 'VENTA',
	`amount` decimal(12,2) NOT NULL,
	`card` varchar(32),
	`authorization_code` varchar(32),
	`linked_entity_type` enum('reservation','quote','none') DEFAULT 'none',
	`linked_entity_id` int,
	`linked_at` timestamp,
	`linked_by` varchar(128),
	`status` enum('pendiente','conciliado','incidencia','ignorado') NOT NULL DEFAULT 'pendiente',
	`incident_reason` text,
	`notes` text,
	`import_id` int,
	`duplicate_key` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `card_terminal_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `card_terminal_operations_duplicate_key_unique` UNIQUE(`duplicate_key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tpv_file_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`file_type` varchar(16) NOT NULL,
	`imported_rows` int NOT NULL DEFAULT 0,
	`duplicates_skipped` int NOT NULL DEFAULT 0,
	`status` enum('ok','error') NOT NULL DEFAULT 'ok',
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tpv_file_imports_id` PRIMARY KEY(`id`)
);
