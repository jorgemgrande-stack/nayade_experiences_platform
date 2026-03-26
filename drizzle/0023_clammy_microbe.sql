CREATE TABLE `cost_centers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cost_centers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`expenseId` int NOT NULL,
	`filePath` varchar(1024) NOT NULL,
	`fileName` varchar(256),
	`mimeType` varchar(128),
	`uploadedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expense_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expense_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`fiscalName` varchar(256),
	`vatNumber` varchar(32),
	`address` text,
	`email` varchar(320),
	`phone` varchar(32),
	`iban` varchar(64),
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expense_suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(20) NOT NULL,
	`concept` varchar(512) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`categoryId` int NOT NULL,
	`supplierId` int,
	`costCenterId` int NOT NULL,
	`paymentMethod` enum('cash','card','transfer','direct_debit','tpv_cash') NOT NULL DEFAULT 'transfer',
	`status` enum('pending','justified','accounted') NOT NULL DEFAULT 'pending',
	`reservationId` int,
	`productId` int,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`concept` varchar(512) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`categoryId` int NOT NULL,
	`costCenterId` int NOT NULL,
	`supplierId` int,
	`recurrenceType` enum('monthly','weekly','yearly') NOT NULL DEFAULT 'monthly',
	`nextExecutionDate` varchar(20) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recurring_expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `lego_packs` ADD `category` enum('dia','escolar','empresa') DEFAULT 'dia' NOT NULL;--> statement-breakpoint
ALTER TABLE `lego_packs` ADD `discountPercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `lego_packs` ADD `discountExpiresAt` timestamp;