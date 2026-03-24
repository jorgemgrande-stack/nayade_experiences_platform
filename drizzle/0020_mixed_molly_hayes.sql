CREATE TABLE `cash_movements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`type_cm` enum('out','in') NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`reason` varchar(300) NOT NULL,
	`cashierName` varchar(200),
	`createdAt` bigint NOT NULL,
	CONSTRAINT `cash_movements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cash_registers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`location` varchar(200),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `cash_registers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`registerId` int NOT NULL,
	`cashierUserId` int NOT NULL,
	`cashierName` varchar(200) NOT NULL,
	`openingAmount` decimal(10,2) NOT NULL DEFAULT '0',
	`closingAmount` decimal(10,2),
	`countedCash` decimal(10,2),
	`cashDifference` decimal(10,2),
	`totalCash` decimal(10,2) DEFAULT '0',
	`totalCard` decimal(10,2) DEFAULT '0',
	`totalBizum` decimal(10,2) DEFAULT '0',
	`totalMixed` decimal(10,2) DEFAULT '0',
	`totalManualOut` decimal(10,2) DEFAULT '0',
	`totalManualIn` decimal(10,2) DEFAULT '0',
	`status_cs` enum('open','closed') NOT NULL DEFAULT 'open',
	`notes` text,
	`openedAt` bigint NOT NULL,
	`closedAt` bigint,
	CONSTRAINT `cash_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tpv_sale_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`saleId` int NOT NULL,
	`productType_tsi` enum('experience','pack','spa','hotel','restaurant','extra') NOT NULL,
	`productId` int NOT NULL,
	`productName` varchar(300) NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`unitPrice` decimal(10,2) NOT NULL,
	`discountPercent_tsi` decimal(5,2) DEFAULT '0',
	`subtotal_tsi` decimal(10,2) NOT NULL,
	`eventDate` varchar(10),
	`eventTime` varchar(10),
	`participants` int DEFAULT 1,
	`notes_tsi` varchar(500),
	CONSTRAINT `tpv_sale_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tpv_sale_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`saleId` int NOT NULL,
	`payerName` varchar(200),
	`method_tsp` enum('cash','card','bizum','other') NOT NULL,
	`amount_tsp` decimal(10,2) NOT NULL,
	`amountTendered` decimal(10,2),
	`changeGiven` decimal(10,2) DEFAULT '0',
	`status_tsp` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
	`reference` varchar(200),
	`createdAt` bigint NOT NULL,
	CONSTRAINT `tpv_sale_payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tpv_sales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ticketNumber` varchar(50) NOT NULL,
	`sessionId` int NOT NULL,
	`reservationId` int,
	`invoiceId` int,
	`customerName` varchar(200),
	`customerEmail` varchar(200),
	`customerPhone` varchar(50),
	`subtotal` decimal(10,2) NOT NULL DEFAULT '0',
	`discountAmount` decimal(10,2) DEFAULT '0',
	`discountReason` varchar(200),
	`total` decimal(10,2) NOT NULL DEFAULT '0',
	`status_ts` enum('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`notes` text,
	`createdAt` bigint NOT NULL,
	`paidAt` bigint,
	CONSTRAINT `tpv_sales_id` PRIMARY KEY(`id`),
	CONSTRAINT `tpv_sales_ticketNumber_unique` UNIQUE(`ticketNumber`)
);
--> statement-breakpoint
ALTER TABLE `experiences` ADD `supplierId` int;--> statement-breakpoint
ALTER TABLE `experiences` ADD `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `experiences` ADD `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta';--> statement-breakpoint
ALTER TABLE `experiences` ADD `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `experiences` ADD `isSettlable` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `packs` ADD `supplierId` int;--> statement-breakpoint
ALTER TABLE `packs` ADD `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `packs` ADD `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta';--> statement-breakpoint
ALTER TABLE `packs` ADD `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `packs` ADD `isSettlable` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `room_types` ADD `discountPercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `room_types` ADD `discountLabel` varchar(128);--> statement-breakpoint
ALTER TABLE `room_types` ADD `discountExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `room_types` ADD `fiscalRegime` enum('reav','general_21','mixed') DEFAULT 'general_21' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_types` ADD `productType` enum('own','semi_own','third_party') DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE `room_types` ADD `providerPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `room_types` ADD `agencyMarginPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `room_types` ADD `supplierId` int;--> statement-breakpoint
ALTER TABLE `room_types` ADD `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `room_types` ADD `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta';--> statement-breakpoint
ALTER TABLE `room_types` ADD `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `room_types` ADD `isSettlable` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `discountPercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `discountLabel` varchar(128);--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `discountExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `fiscalRegime` enum('reav','general_21','mixed') DEFAULT 'general_21' NOT NULL;--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `productType` enum('own','semi_own','third_party') DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `providerPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `agencyMarginPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `supplierId` int;--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `supplierCommissionPercent` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `supplierCostType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') DEFAULT 'comision_sobre_venta';--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `settlementFrequency` enum('semanal','quincenal','mensual','manual') DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `spa_treatments` ADD `isSettlable` boolean DEFAULT false NOT NULL;