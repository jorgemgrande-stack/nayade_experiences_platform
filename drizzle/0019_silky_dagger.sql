CREATE TABLE `settlement_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settlementId` int NOT NULL,
	`docType` enum('factura_recibida','contrato','justificante_pago','email','acuerdo_comision','otro') NOT NULL DEFAULT 'otro',
	`title` varchar(256) NOT NULL,
	`fileUrl` text,
	`fileKey` text,
	`notes` text,
	`uploadedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `settlement_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settlement_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settlementId` int NOT NULL,
	`reservationId` int,
	`invoiceId` int,
	`productId` int,
	`productName` varchar(256),
	`serviceDate` varchar(10),
	`paxCount` int NOT NULL DEFAULT 1,
	`saleAmount` decimal(12,2) NOT NULL,
	`commissionPercent` decimal(5,2) NOT NULL,
	`commissionAmount` decimal(12,2) NOT NULL,
	`netAmountProvider` decimal(12,2) NOT NULL,
	`costType` enum('comision_sobre_venta','coste_fijo','porcentaje_margen','hibrido') NOT NULL DEFAULT 'comision_sobre_venta',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `settlement_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settlement_status_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settlementId` int NOT NULL,
	`fromStatus` varchar(64),
	`toStatus` varchar(64) NOT NULL,
	`changedBy` int,
	`changedByName` varchar(256),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `settlement_status_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supplier_settlements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settlementNumber` varchar(64) NOT NULL,
	`supplierId` int NOT NULL,
	`periodFrom` varchar(10) NOT NULL,
	`periodTo` varchar(10) NOT NULL,
	`grossAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`commissionAmount` decimal(12,2) NOT NULL DEFAULT '0.00',
	`netAmountProvider` decimal(12,2) NOT NULL DEFAULT '0.00',
	`currency` varchar(8) NOT NULL DEFAULT 'EUR',
	`status` enum('emitida','pendiente_abono','abonada','incidencia','recalculada') NOT NULL DEFAULT 'emitida',
	`pdfUrl` text,
	`pdfKey` text,
	`sentAt` timestamp,
	`paidAt` timestamp,
	`internalNotes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supplier_settlements_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplier_settlements_settlementNumber_unique` UNIQUE(`settlementNumber`)
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`fiscalName` varchar(256) NOT NULL,
	`commercialName` varchar(256),
	`nif` varchar(32),
	`fiscalAddress` text,
	`adminEmail` varchar(320),
	`phone` varchar(32),
	`contactPerson` varchar(256),
	`iban` varchar(64),
	`paymentMethod` enum('transferencia','confirming','efectivo','compensacion') NOT NULL DEFAULT 'transferencia',
	`standardCommissionPercent` decimal(5,2) DEFAULT '0.00',
	`internalNotes` text,
	`status` enum('activo','inactivo','bloqueado') NOT NULL DEFAULT 'activo',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`)
);
