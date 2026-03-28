CREATE TABLE `platform_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform_id` int NOT NULL,
	`experience_id` int,
	`external_link` text,
	`external_product_name` varchar(256),
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platform_settlements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform_id` int NOT NULL,
	`period_label` varchar(64) NOT NULL,
	`period_from` varchar(20),
	`period_to` varchar(20),
	`total_coupons` int NOT NULL DEFAULT 0,
	`total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
	`status` enum('pendiente_cobro','cobrado') NOT NULL DEFAULT 'pendiente_cobro',
	`justificant_url` text,
	`notes` text,
	`settled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platform_settlements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`slug` varchar(64) NOT NULL,
	`logo_url` text,
	`active` boolean NOT NULL DEFAULT true,
	`settlement_frequency` enum('quincenal','mensual','trimestral') NOT NULL DEFAULT 'mensual',
	`commission_pct` decimal(5,2) DEFAULT '20.00',
	`external_url` text,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `platforms_id` PRIMARY KEY(`id`),
	CONSTRAINT `platforms_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `coupon_redemptions` MODIFY COLUMN `statusOperational` enum('recibido','pendiente','reserva_generada') NOT NULL DEFAULT 'recibido';--> statement-breakpoint
ALTER TABLE `coupon_redemptions` MODIFY COLUMN `statusFinancial` enum('pendiente_canjear','canjeado','incidencia') NOT NULL DEFAULT 'pendiente_canjear';