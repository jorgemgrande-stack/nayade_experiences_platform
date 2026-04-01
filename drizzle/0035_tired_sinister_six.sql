CREATE TABLE `product_time_slots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`type` enum('fixed','flexible','range') NOT NULL DEFAULT 'fixed',
	`label` varchar(128) NOT NULL,
	`start_time` varchar(10),
	`end_time` varchar(10),
	`days_of_week` varchar(32),
	`capacity` int,
	`price_override` decimal(10,2),
	`sort_order` int NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_time_slots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `supplier_settlements` MODIFY COLUMN `status` enum('borrador','emitida','pendiente_abono','abonada','incidencia','recalculada') NOT NULL DEFAULT 'emitida';--> statement-breakpoint
ALTER TABLE `experiences` ADD `has_time_slots` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `selected_time_slot_id` int;--> statement-breakpoint
ALTER TABLE `reservations` ADD `selected_time` varchar(10);