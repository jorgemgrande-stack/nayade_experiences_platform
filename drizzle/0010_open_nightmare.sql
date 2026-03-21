CREATE TABLE `crm_activity_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('lead','quote','reservation','invoice') NOT NULL,
	`entityId` int NOT NULL,
	`action` varchar(128) NOT NULL,
	`actorId` int,
	`actorName` varchar(256),
	`details` json DEFAULT ('{}'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crm_activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceNumber` varchar(32) NOT NULL,
	`quoteId` int,
	`reservationId` int,
	`clientName` varchar(256) NOT NULL,
	`clientEmail` varchar(320) NOT NULL,
	`clientPhone` varchar(32),
	`clientNif` varchar(32),
	`clientAddress` text,
	`itemsJson` json DEFAULT ('[]'),
	`subtotal` decimal(10,2) NOT NULL,
	`taxRate` decimal(5,2) DEFAULT '21',
	`taxAmount` decimal(10,2) DEFAULT '0',
	`total` decimal(10,2) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`pdfUrl` text,
	`pdfKey` text,
	`status` enum('generada','enviada','anulada') NOT NULL DEFAULT 'generada',
	`issuedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`)
);
--> statement-breakpoint
ALTER TABLE `quotes` MODIFY COLUMN `status` enum('borrador','enviado','aceptado','rechazado','expirado','perdido') NOT NULL DEFAULT 'borrador';--> statement-breakpoint
ALTER TABLE `leads` ADD `opportunityStatus` enum('nueva','enviada','ganada','perdida') DEFAULT 'nueva' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `priority` enum('baja','media','alta') DEFAULT 'media' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `lastContactAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `lostReason` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `seenAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `internalNotes` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `quotes` ADD `sentAt` timestamp;--> statement-breakpoint
ALTER TABLE `quotes` ADD `viewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `quotes` ADD `conditions` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `redsysOrderId` varchar(32);--> statement-breakpoint
ALTER TABLE `quotes` ADD `invoiceNumber` varchar(32);--> statement-breakpoint
ALTER TABLE `quotes` ADD `invoicePdfUrl` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `invoiceGeneratedAt` timestamp;