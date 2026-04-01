ALTER TABLE `suppliers` ADD `settlementFrequency` enum('quincenal','mensual','trimestral','semestral','anual','manual') DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `settlementDayOfMonth` int DEFAULT 1;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `autoGenerateSettlements` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tpv_sales` ADD `serviceDate` varchar(10);