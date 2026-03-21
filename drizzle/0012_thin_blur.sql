ALTER TABLE `clients` ADD `leadId` int;--> statement-breakpoint
ALTER TABLE `clients` ADD `source` varchar(64) DEFAULT 'lead' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `city` varchar(128) DEFAULT '';--> statement-breakpoint
ALTER TABLE `clients` ADD `postalCode` varchar(16) DEFAULT '';--> statement-breakpoint
ALTER TABLE `clients` ADD `country` varchar(64) DEFAULT 'ES';--> statement-breakpoint
ALTER TABLE `clients` ADD `birthDate` varchar(10);--> statement-breakpoint
ALTER TABLE `clients` ADD `tags` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `clients` ADD `isConverted` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `totalBookings` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `totalSpent` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `clients` ADD `lastBookingAt` timestamp;