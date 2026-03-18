CREATE TABLE `home_module_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`module_key` varchar(64) NOT NULL,
	`experience_id` int NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` bigint NOT NULL,
	CONSTRAINT `home_module_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pack_cross_sells` (
	`id` int AUTO_INCREMENT NOT NULL,
	`packId` int NOT NULL,
	`relatedPackId` int NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `pack_cross_sells_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `packs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`category` enum('dia','escolar','empresa') NOT NULL,
	`title` varchar(256) NOT NULL,
	`subtitle` varchar(512),
	`shortDescription` text,
	`description` text,
	`includes` json DEFAULT ('[]'),
	`excludes` json DEFAULT ('[]'),
	`schedule` text,
	`note` text,
	`image1` text,
	`image2` text,
	`image3` text,
	`image4` text,
	`basePrice` decimal(10,2) NOT NULL DEFAULT '0',
	`priceLabel` varchar(128),
	`duration` varchar(128),
	`minPersons` int DEFAULT 1,
	`maxPersons` int,
	`targetAudience` varchar(256),
	`badge` varchar(64),
	`hasStay` boolean NOT NULL DEFAULT false,
	`isOnlinePurchase` boolean NOT NULL DEFAULT false,
	`isFeatured` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`metaTitle` varchar(256),
	`metaDescription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `packs_id` PRIMARY KEY(`id`),
	CONSTRAINT `packs_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`product_name` varchar(255) NOT NULL,
	`booking_date` varchar(20) NOT NULL,
	`people` int NOT NULL DEFAULT 1,
	`extras_json` text,
	`amount_total` int NOT NULL,
	`amount_paid` int DEFAULT 0,
	`status` enum('draft','pending_payment','paid','failed','cancelled') NOT NULL DEFAULT 'draft',
	`customer_name` varchar(255) NOT NULL,
	`customer_email` varchar(255) NOT NULL,
	`customer_phone` varchar(50),
	`merchant_order` varchar(12) NOT NULL,
	`redsys_response` text,
	`redsys_ds_response` varchar(10),
	`notes` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	`paid_at` bigint,
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `reservations_merchant_order_unique` UNIQUE(`merchant_order`)
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `image1` text;--> statement-breakpoint
ALTER TABLE `experiences` ADD `image1` text;--> statement-breakpoint
ALTER TABLE `experiences` ADD `image2` text;--> statement-breakpoint
ALTER TABLE `experiences` ADD `image3` text;--> statement-breakpoint
ALTER TABLE `experiences` ADD `image4` text;--> statement-breakpoint
ALTER TABLE `slideshow_items` ADD `badge` varchar(128);--> statement-breakpoint
ALTER TABLE `slideshow_items` ADD `description` text;--> statement-breakpoint
ALTER TABLE `slideshow_items` ADD `reserveUrl` varchar(512);