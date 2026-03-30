ALTER TABLE `discount_codes` MODIFY COLUMN `discount_percent` decimal(5,2) NOT NULL DEFAULT '0';--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `discount_type` enum('percent','fixed') DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `discount_amount` decimal(10,2);--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `origin` enum('manual','voucher') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `compensation_voucher_id` int;--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `client_email` varchar(256);--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `client_name` varchar(256);