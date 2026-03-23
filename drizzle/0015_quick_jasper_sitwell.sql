ALTER TABLE `bookings` ADD `reservationId` int;--> statement-breakpoint
ALTER TABLE `bookings` ADD `sourceChannel` enum('manual','redsys','transferencia','efectivo','otro') DEFAULT 'manual';