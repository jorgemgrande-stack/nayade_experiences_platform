ALTER TABLE `reservations` ADD `reservation_number` varchar(32);--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_reservation_number_unique` ON `reservations` (`reservation_number`);
