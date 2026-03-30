CREATE TABLE `document_counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`document_type` varchar(32) NOT NULL,
	`year` int NOT NULL,
	`current_number` int NOT NULL DEFAULT 0,
	`prefix` varchar(16) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `document_counters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_number_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`document_type` varchar(32) NOT NULL,
	`document_number` varchar(64) NOT NULL,
	`year` int NOT NULL,
	`sequence` int NOT NULL,
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	`generated_by` varchar(64),
	`context` varchar(128),
	CONSTRAINT `document_number_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitor_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`monitor_id` int NOT NULL,
	`type` enum('dni','contrato','certificado','otro') NOT NULL DEFAULT 'otro',
	`name` varchar(255) NOT NULL,
	`file_url` text NOT NULL,
	`file_key` varchar(512) NOT NULL,
	`uploaded_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monitor_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitor_payroll` (
	`id` int AUTO_INCREMENT NOT NULL,
	`monitor_id` int NOT NULL,
	`year` int NOT NULL,
	`month` int NOT NULL,
	`base_salary` decimal(10,2) NOT NULL DEFAULT '0',
	`extras` json DEFAULT ('[]'),
	`total_amount` decimal(10,2) NOT NULL DEFAULT '0',
	`status` enum('pendiente','pagado') NOT NULL DEFAULT 'pendiente',
	`paid_at` timestamp,
	`notes` text,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitor_payroll_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`dni` varchar(20),
	`phone` varchar(30),
	`email` varchar(255),
	`address` text,
	`birth_date` timestamp,
	`photo_url` text,
	`photo_key` varchar(512),
	`emergency_name` varchar(255),
	`emergency_relation` varchar(128),
	`emergency_phone` varchar(30),
	`iban` varchar(34),
	`iban_holder` varchar(255),
	`contract_type` enum('indefinido','temporal','autonomo','practicas','otro') DEFAULT 'temporal',
	`contract_start` timestamp,
	`contract_end` timestamp,
	`contract_conditions` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`notes` text,
	`user_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservation_operational` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservation_id` int NOT NULL,
	`reservation_type` enum('activity','restaurant','hotel','spa','pack') NOT NULL DEFAULT 'activity',
	`client_confirmed` boolean NOT NULL DEFAULT false,
	`client_confirmed_at` timestamp,
	`client_confirmed_by` int,
	`arrival_time` varchar(10),
	`op_notes` text,
	`monitor_id` int,
	`op_status` enum('pendiente','confirmado','incidencia','completado') NOT NULL DEFAULT 'pendiente',
	`updated_by` int,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reservation_operational_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservation_operational_reservation_id_unique` UNIQUE(`reservation_id`)
);
