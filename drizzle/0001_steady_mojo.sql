CREATE TABLE `booking_monitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`monitorId` int NOT NULL,
	`role` varchar(128) DEFAULT 'monitor',
	`notifiedAt` timestamp,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingNumber` varchar(32) NOT NULL,
	`experienceId` int NOT NULL,
	`quoteId` int,
	`clientName` varchar(256) NOT NULL,
	`clientEmail` varchar(320) NOT NULL,
	`clientPhone` varchar(32),
	`scheduledDate` timestamp NOT NULL,
	`endDate` timestamp,
	`numberOfPersons` int NOT NULL,
	`totalAmount` decimal(10,2) NOT NULL,
	`status` enum('pendiente','confirmado','en_curso','completado','cancelado') NOT NULL DEFAULT 'pendiente',
	`notes` text,
	`internalNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_bookingNumber_unique` UNIQUE(`bookingNumber`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`imageUrl` text,
	`iconName` varchar(64),
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `daily_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` timestamp NOT NULL,
	`bookingId` int NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text,
	`meetingPoint` text,
	`equipment` json DEFAULT ('[]'),
	`specialInstructions` text,
	`status` enum('borrador','publicado','completado') NOT NULL DEFAULT 'borrador',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `experience_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`experienceId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`priceModifier` decimal(10,2) DEFAULT '0',
	`priceType` enum('fixed','percentage','per_person') NOT NULL DEFAULT 'fixed',
	`options` json DEFAULT ('[]'),
	`isRequired` boolean NOT NULL DEFAULT false,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `experience_variants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `experiences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`title` varchar(256) NOT NULL,
	`shortDescription` text,
	`description` text,
	`categoryId` int NOT NULL,
	`locationId` int NOT NULL,
	`coverImageUrl` text,
	`gallery` json DEFAULT ('[]'),
	`basePrice` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`duration` varchar(128),
	`minPersons` int DEFAULT 1,
	`maxPersons` int,
	`difficulty` enum('facil','moderado','dificil','experto') DEFAULT 'facil',
	`includes` json DEFAULT ('[]'),
	`excludes` json DEFAULT ('[]'),
	`requirements` text,
	`isFeatured` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`metaTitle` varchar(256),
	`metaDescription` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `experiences_id` PRIMARY KEY(`id`),
	CONSTRAINT `experiences_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `ghl_webhook_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event` varchar(128) NOT NULL,
	`payload` json,
	`status` enum('recibido','procesado','error') NOT NULL DEFAULT 'recibido',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ghl_webhook_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(32),
	`company` varchar(256),
	`message` text,
	`experienceId` int,
	`locationId` int,
	`preferredDate` timestamp,
	`numberOfPersons` int,
	`budget` decimal(10,2),
	`status` enum('nuevo','contactado','en_proceso','convertido','perdido') NOT NULL DEFAULT 'nuevo',
	`assignedTo` int,
	`ghlContactId` varchar(128),
	`source` varchar(128) DEFAULT 'web',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`imageUrl` text,
	`address` text,
	`latitude` decimal(10,8),
	`longitude` decimal(11,8),
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(256) NOT NULL,
	`originalName` varchar(256) NOT NULL,
	`url` text NOT NULL,
	`fileKey` text NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`size` int NOT NULL,
	`type` enum('image','video','document') NOT NULL DEFAULT 'image',
	`altText` text,
	`uploadedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `media_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parentId` int,
	`label` varchar(128) NOT NULL,
	`url` varchar(512),
	`target` enum('_self','_blank') NOT NULL DEFAULT '_self',
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`menuZone` enum('header','footer') NOT NULL DEFAULT 'header',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `menu_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteNumber` varchar(32) NOT NULL,
	`leadId` int NOT NULL,
	`agentId` int NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text,
	`items` json DEFAULT ('[]'),
	`subtotal` decimal(10,2) NOT NULL,
	`discount` decimal(10,2) DEFAULT '0',
	`tax` decimal(10,2) DEFAULT '0',
	`total` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`validUntil` timestamp,
	`status` enum('borrador','enviado','aceptado','rechazado','expirado') NOT NULL DEFAULT 'borrador',
	`paymentLinkToken` varchar(128),
	`paymentLinkUrl` text,
	`paidAt` timestamp,
	`notes` text,
	`ghlOpportunityId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotes_quoteNumber_unique` UNIQUE(`quoteNumber`),
	CONSTRAINT `quotes_paymentLinkToken_unique` UNIQUE(`paymentLinkToken`)
);
--> statement-breakpoint
CREATE TABLE `site_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text,
	`type` enum('text','json','image','boolean') NOT NULL DEFAULT 'text',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `site_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `slideshow_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`imageUrl` text NOT NULL,
	`title` varchar(256),
	`subtitle` text,
	`ctaText` varchar(128),
	`ctaUrl` varchar(512),
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `slideshow_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `static_pages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(256) NOT NULL,
	`title` varchar(256) NOT NULL,
	`content` text,
	`metaTitle` varchar(256),
	`metaDescription` text,
	`isPublished` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `static_pages_id` PRIMARY KEY(`id`),
	CONSTRAINT `static_pages_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`transactionNumber` varchar(32) NOT NULL,
	`bookingId` int,
	`quoteId` int,
	`type` enum('ingreso','reembolso','comision','gasto') NOT NULL DEFAULT 'ingreso',
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`paymentMethod` enum('tarjeta','transferencia','efectivo','link_pago','otro') DEFAULT 'tarjeta',
	`status` enum('pendiente','completado','fallido','reembolsado') NOT NULL DEFAULT 'pendiente',
	`description` text,
	`externalRef` varchar(256),
	`processedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `transactions_transactionNumber_unique` UNIQUE(`transactionNumber`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','monitor','agente') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `avatarUrl` text;--> statement-breakpoint
ALTER TABLE `users` ADD `isActive` boolean DEFAULT true NOT NULL;