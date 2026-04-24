CREATE TABLE IF NOT EXISTS `bank_file_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`file_type` varchar(10) NOT NULL,
	`imported_rows` int NOT NULL DEFAULT 0,
	`duplicates_skipped` int NOT NULL DEFAULT 0,
	`status` enum('ok','error','parcial') NOT NULL DEFAULT 'ok',
	`error_message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_file_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bank_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`import_id` int NOT NULL,
	`fecha` varchar(12) NOT NULL,
	`fecha_valor` varchar(12),
	`movimiento` varchar(255),
	`mas_datos` text,
	`importe` decimal(12,2) NOT NULL,
	`saldo` decimal(12,2),
	`duplicate_key` varchar(255) NOT NULL,
	`status` enum('pendiente','ignorado') NOT NULL DEFAULT 'pendiente',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_movements_id` PRIMARY KEY(`id`),
	CONSTRAINT `bank_movements_duplicate_key_unique` UNIQUE(`duplicate_key`)
);
