ALTER TABLE `reservations` MODIFY COLUMN `channel` enum('web','crm','telefono','email','otro','tpv','groupon') DEFAULT 'web';--> statement-breakpoint
ALTER TABLE `reservations` ADD `origin_source` varchar(64);--> statement-breakpoint
ALTER TABLE `reservations` ADD `redemption_id` int;