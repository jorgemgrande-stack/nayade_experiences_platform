CREATE TABLE `discount_code_uses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`discount_code_id` int NOT NULL,
	`code_use` varchar(50) NOT NULL,
	`discount_percent_use` decimal(5,2) NOT NULL,
	`discount_amount` decimal(10,2) NOT NULL,
	`original_amount_use` decimal(10,2) NOT NULL,
	`final_amount` decimal(10,2) NOT NULL,
	`channel_dcu` enum('tpv','online','crm','delegated') NOT NULL,
	`reservation_id` int,
	`tpv_sale_id` int,
	`applied_by_user_id` varchar(100),
	`applied_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `discount_code_uses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `discount_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`discount_percent` decimal(5,2) NOT NULL,
	`expires_at` timestamp,
	`status_dc` enum('active','inactive','expired') NOT NULL DEFAULT 'active',
	`max_uses` int,
	`current_uses` int NOT NULL DEFAULT 0,
	`observations` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `discount_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `discount_codes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `customer_email` varchar(255);--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `channel` enum('web','crm','telefono','email','otro','tpv') DEFAULT 'web';--> statement-breakpoint
ALTER TABLE `experiences` ADD `isPresentialSale` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `packs` ADD `isPresentialSale` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `clientName` varchar(256);--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `clientEmail` varchar(256);--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `clientPhone` varchar(64);--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `clientDni` varchar(64);--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `clientAddress` varchar(512);--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `channel` enum('tpv','online','crm','manual') DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `sourceRef` varchar(128);--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `tpvSaleId` int;--> statement-breakpoint
ALTER TABLE `reav_expedients` ADD `quoteId` int;--> statement-breakpoint
ALTER TABLE `room_types` ADD `isPresentialSale` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `isPresentialSale` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `fiscalRegime_tsi` enum('reav','general_21','mixed') DEFAULT 'general_21';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `taxBase_tsi` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `taxAmount_tsi` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `taxRate_tsi` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `reavCost_tsi` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `reavMargin_tsi` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sale_items` ADD `reavTax_tsi` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `taxBase` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `taxAmount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `taxRate` decimal(5,2) DEFAULT '21';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `reavMargin` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `reavCost` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `reavTax` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `fiscalSummary` varchar(20) DEFAULT 'mixed';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `saleChannel` varchar(20) DEFAULT 'tpv';--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `sellerUserId` int;--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `sellerName` varchar(200);--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `operativeCenter` varchar(100);--> statement-breakpoint
ALTER TABLE `transactions` ADD `clientName` varchar(200);--> statement-breakpoint
ALTER TABLE `transactions` ADD `clientEmail` varchar(200);--> statement-breakpoint
ALTER TABLE `transactions` ADD `clientPhone` varchar(50);--> statement-breakpoint
ALTER TABLE `transactions` ADD `productName` varchar(300);--> statement-breakpoint
ALTER TABLE `transactions` ADD `operativeCenter` varchar(100);--> statement-breakpoint
ALTER TABLE `transactions` ADD `sellerUserId` int;--> statement-breakpoint
ALTER TABLE `transactions` ADD `sellerName` varchar(200);--> statement-breakpoint
ALTER TABLE `transactions` ADD `saleChannel` enum('tpv','online','crm','admin','delegado') DEFAULT 'admin';--> statement-breakpoint
ALTER TABLE `transactions` ADD `taxBase` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `transactions` ADD `taxAmount` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `transactions` ADD `reavMargin` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `transactions` ADD `fiscalRegime_tx` enum('reav','general_21','mixed') DEFAULT 'general_21';--> statement-breakpoint
ALTER TABLE `transactions` ADD `tpvSaleId` int;--> statement-breakpoint
ALTER TABLE `transactions` ADD `reservationId_tx` int;--> statement-breakpoint
ALTER TABLE `transactions` ADD `invoiceNumber` varchar(32);--> statement-breakpoint
ALTER TABLE `transactions` ADD `reservationRef` varchar(32);--> statement-breakpoint
ALTER TABLE `transactions` ADD `operationStatus` enum('confirmada','anulada','reembolsada') DEFAULT 'confirmada';