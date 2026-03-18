CREATE TABLE `room_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomTypeId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`availableUnits` int NOT NULL DEFAULT 0,
	`reason` varchar(256),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `room_blocks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_rate_seasons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`startDate` varchar(10) NOT NULL,
	`endDate` varchar(10) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `room_rate_seasons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomTypeId` int NOT NULL,
	`seasonId` int,
	`dayOfWeek` int,
	`specificDate` varchar(10),
	`pricePerNight` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`supplement` decimal(10,2) DEFAULT '0',
	`supplementLabel` varchar(128),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `room_rates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_types` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`name` varchar(256) NOT NULL,
	`shortDescription` text,
	`description` text,
	`coverImageUrl` text,
	`image1` text,
	`image2` text,
	`image3` text,
	`image4` text,
	`gallery` json DEFAULT ('[]'),
	`maxAdults` int NOT NULL DEFAULT 2,
	`maxChildren` int NOT NULL DEFAULT 0,
	`maxOccupancy` int NOT NULL DEFAULT 2,
	`surfaceM2` int,
	`amenities` json DEFAULT ('[]'),
	`basePrice` decimal(10,2) NOT NULL DEFAULT '0',
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`totalUnits` int NOT NULL DEFAULT 1,
	`isFeatured` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`metaTitle` varchar(256),
	`metaDescription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `room_types_id` PRIMARY KEY(`id`),
	CONSTRAINT `room_types_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `spa_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`iconName` varchar(64),
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spa_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `spa_categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `spa_resources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('cabina','terapeuta') NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spa_resources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spa_schedule_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`treatmentId` int NOT NULL,
	`resourceId` int,
	`dayOfWeek` int NOT NULL,
	`startTime` varchar(5) NOT NULL,
	`endTime` varchar(5) NOT NULL,
	`capacity` int NOT NULL DEFAULT 1,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `spa_schedule_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spa_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`treatmentId` int NOT NULL,
	`resourceId` int,
	`date` varchar(10) NOT NULL,
	`startTime` varchar(5) NOT NULL,
	`endTime` varchar(5) NOT NULL,
	`capacity` int NOT NULL DEFAULT 1,
	`bookedCount` int NOT NULL DEFAULT 0,
	`status` enum('disponible','reservado','bloqueado') NOT NULL DEFAULT 'disponible',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `spa_slots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `spa_treatments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`name` varchar(256) NOT NULL,
	`categoryId` int,
	`shortDescription` text,
	`description` text,
	`benefits` json DEFAULT ('[]'),
	`coverImageUrl` text,
	`image1` text,
	`image2` text,
	`gallery` json DEFAULT ('[]'),
	`durationMinutes` int NOT NULL DEFAULT 60,
	`price` decimal(10,2) NOT NULL DEFAULT '0',
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`maxPersons` int NOT NULL DEFAULT 1,
	`cabinRequired` boolean NOT NULL DEFAULT true,
	`isFeatured` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`metaTitle` varchar(256),
	`metaDescription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `spa_treatments_id` PRIMARY KEY(`id`),
	CONSTRAINT `spa_treatments_slug_unique` UNIQUE(`slug`)
);
