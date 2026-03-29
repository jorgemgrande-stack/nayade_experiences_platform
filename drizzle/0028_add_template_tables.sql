CREATE TABLE `cancellation_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`request_id` int NOT NULL,
	`action_type` varchar(64) NOT NULL,
	`old_status` varchar(64),
	`new_status` varchar(64),
	`payload` json,
	`admin_user_id` int,
	`admin_user_name` varchar(256),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cancellation_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cancellation_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`full_name` varchar(256) NOT NULL,
	`email` varchar(320),
	`phone` varchar(32),
	`activity_date` varchar(32) NOT NULL,
	`reason` enum('meteorologicas','accidente','enfermedad','desistimiento','otra') NOT NULL,
	`reason_detail` text,
	`terms_checked` boolean NOT NULL DEFAULT false,
	`source` varchar(64) NOT NULL DEFAULT 'landing_publica',
	`locator` varchar(128),
	`origin_url` text,
	`ip_address` varchar(64),
	`form_language` varchar(8) DEFAULT 'es',
	`linked_reservation_id` int,
	`linked_quote_id` int,
	`linked_invoice_id` int,
	`original_amount` decimal(10,2),
	`refundable_amount` decimal(10,2),
	`resolved_amount` decimal(10,2),
	`activity_type` varchar(128),
	`sale_channel` varchar(64),
	`invoice_ref` varchar(128),
	`operational_status` enum('recibida','en_revision','pendiente_documentacion','pendiente_decision','resuelta','cerrada','incidencia') NOT NULL DEFAULT 'recibida',
	`resolution_status` enum('sin_resolver','rechazada','aceptada_total','aceptada_parcial') NOT NULL DEFAULT 'sin_resolver',
	`financial_status` enum('sin_compensacion','pendiente_devolucion','devuelta_economicamente','pendiente_bono','compensada_bono','compensacion_mixta','incidencia_economica') NOT NULL DEFAULT 'sin_compensacion',
	`compensation_type` enum('ninguna','devolucion','bono','mixta') DEFAULT 'ninguna',
	`voucher_id` int,
	`admin_notes` text,
	`assigned_user_id` int,
	`closed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cancellation_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `compensation_vouchers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`request_id` int NOT NULL,
	`code` varchar(32) NOT NULL,
	`type` enum('actividad','servicio','monetario') NOT NULL DEFAULT 'actividad',
	`activity_id` int,
	`activity_name` varchar(256),
	`value` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`issued_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	`status` enum('generado','enviado','canjeado','caducado','anulado') NOT NULL DEFAULT 'generado',
	`pdf_url` text,
	`conditions` text,
	`notes` text,
	`sent_at` timestamp,
	`redeemed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `compensation_vouchers_id` PRIMARY KEY(`id`),
	CONSTRAINT `compensation_vouchers_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` varchar(100) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`category` varchar(50) NOT NULL DEFAULT 'general',
	`recipient` varchar(20) NOT NULL DEFAULT 'cliente',
	`subject` varchar(300) NOT NULL,
	`header_image_url` text,
	`header_title` varchar(200),
	`header_subtitle` varchar(300),
	`body_html` text NOT NULL,
	`footer_text` text,
	`cta_label` varchar(100),
	`cta_url` text,
	`variables` text,
	`is_custom` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pdf_templates` (
	`id` varchar(100) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`category` varchar(50) NOT NULL DEFAULT 'general',
	`logo_url` text,
	`header_color` varchar(20) DEFAULT '#0a1628',
	`accent_color` varchar(20) DEFAULT '#f97316',
	`company_name` varchar(200),
	`company_address` text,
	`company_phone` varchar(50),
	`company_email` varchar(200),
	`company_nif` varchar(50),
	`footer_text` text,
	`legal_text` text,
	`show_logo` boolean NOT NULL DEFAULT true,
	`show_watermark` boolean NOT NULL DEFAULT false,
	`body_html` text NOT NULL,
	`variables` text,
	`is_custom` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pdf_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `platform_settlements` MODIFY COLUMN `status` enum('pendiente','emitida','pagada') NOT NULL DEFAULT 'pendiente';--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `platformProductId` int;--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `settlementId` int;--> statement-breakpoint
ALTER TABLE `platform_products` ADD `pvp_price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `platform_products` ADD `net_price` decimal(10,2);--> statement-breakpoint
ALTER TABLE `platform_products` ADD `expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `platform_products` ADD `updated_at` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP;--> statement-breakpoint
ALTER TABLE `platform_settlements` ADD `invoice_ref` varchar(128);--> statement-breakpoint
ALTER TABLE `platform_settlements` ADD `coupon_ids` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `platform_settlements` ADD `net_total` decimal(10,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `platform_settlements` ADD `emitted_at` timestamp;--> statement-breakpoint
ALTER TABLE `platform_settlements` ADD `paid_at` timestamp;--> statement-breakpoint
ALTER TABLE `reservations` ADD `platform_name` varchar(128);--> statement-breakpoint
ALTER TABLE `platform_settlements` DROP COLUMN `settled_at`;