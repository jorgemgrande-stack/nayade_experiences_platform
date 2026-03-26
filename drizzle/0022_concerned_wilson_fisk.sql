CREATE TABLE `lego_pack_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legoPackId` int NOT NULL,
	`sourceType` enum('experience','pack') NOT NULL,
	`sourceId` int NOT NULL,
	`internalName` varchar(256),
	`groupLabel` varchar(128),
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`isRequired` boolean NOT NULL DEFAULT true,
	`isOptional` boolean NOT NULL DEFAULT false,
	`isClientEditable` boolean NOT NULL DEFAULT false,
	`isClientVisible` boolean NOT NULL DEFAULT true,
	`defaultQuantity` int NOT NULL DEFAULT 1,
	`isQuantityEditable` boolean NOT NULL DEFAULT false,
	`discountType` enum('percent','fixed') NOT NULL DEFAULT 'percent',
	`discountValue` decimal(10,2) NOT NULL DEFAULT '0',
	`frontendNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lego_pack_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lego_pack_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`legoPackId` int NOT NULL,
	`legoPackTitle` varchar(256) NOT NULL,
	`operationType` enum('reservation','quote','tpv_sale','invoice') NOT NULL,
	`operationId` int NOT NULL,
	`linesSnapshot` json NOT NULL,
	`totalOriginal` decimal(12,2) NOT NULL,
	`totalDiscount` decimal(12,2) NOT NULL,
	`totalFinal` decimal(12,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lego_pack_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lego_packs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`title` varchar(256) NOT NULL,
	`subtitle` varchar(512),
	`shortDescription` text,
	`description` text,
	`coverImageUrl` text,
	`image1` text,
	`image2` text,
	`image3` text,
	`image4` text,
	`gallery` json DEFAULT ('[]'),
	`badge` varchar(64),
	`priceLabel` varchar(128),
	`categoryId` int,
	`targetAudience` varchar(256),
	`availabilityMode` enum('strict','flexible') NOT NULL DEFAULT 'strict',
	`isActive` boolean NOT NULL DEFAULT true,
	`isPublished` boolean NOT NULL DEFAULT false,
	`isFeatured` boolean NOT NULL DEFAULT false,
	`isPresentialSale` boolean NOT NULL DEFAULT true,
	`isOnlineSale` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`metaTitle` varchar(256),
	`metaDescription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lego_packs_id` PRIMARY KEY(`id`),
	CONSTRAINT `lego_packs_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `reservations` MODIFY COLUMN `merchant_order` varchar(30) NOT NULL;--> statement-breakpoint
ALTER TABLE `discount_codes` ADD `status` enum('active','inactive','expired') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `discount_codes` DROP COLUMN `status_dc`;