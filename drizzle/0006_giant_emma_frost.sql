CREATE TABLE `password_reset_tokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`token` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `password_reset_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_reset_tokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_booking_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`action` varchar(128) NOT NULL,
	`details` text,
	`userId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `restaurant_booking_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locator` varchar(16) NOT NULL,
	`restaurantId` int NOT NULL,
	`shiftId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`time` varchar(5) NOT NULL,
	`guests` int NOT NULL,
	`depositAmount` decimal(8,2) NOT NULL,
	`guestName` varchar(256) NOT NULL,
	`guestLastName` varchar(256),
	`guestEmail` varchar(320) NOT NULL,
	`guestPhone` varchar(32),
	`highchair` boolean DEFAULT false,
	`allergies` text,
	`birthday` boolean DEFAULT false,
	`specialRequests` text,
	`accessibility` boolean DEFAULT false,
	`isVip` boolean DEFAULT false,
	`status` enum('pending_payment','confirmed','payment_failed','cancelled','modified','no_show','completed') NOT NULL DEFAULT 'pending_payment',
	`cancellationReason` text,
	`adminNotes` text,
	`channel` enum('web','manual','admin') NOT NULL DEFAULT 'web',
	`createdByUserId` int,
	`paymentStatus` enum('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
	`paymentTransactionId` varchar(256),
	`paymentMethod` varchar(64),
	`merchantOrder` varchar(32),
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurant_bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurant_bookings_locator_unique` UNIQUE(`locator`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_closures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`shiftId` int,
	`reason` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `restaurant_closures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_shifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`restaurantId` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`startTime` varchar(5) NOT NULL,
	`endTime` varchar(5) NOT NULL,
	`maxCapacity` int NOT NULL,
	`daysOfWeek` json DEFAULT ('[0,1,2,3,4,5,6]'),
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `restaurant_shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurant_staff` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`restaurantId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `restaurant_staff_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restaurants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`name` varchar(256) NOT NULL,
	`shortDesc` text,
	`longDesc` text,
	`cuisine` varchar(256),
	`heroImage` text,
	`galleryImages` json DEFAULT ('[]'),
	`menuUrl` text,
	`phone` varchar(32),
	`email` varchar(320),
	`location` varchar(512),
	`badge` varchar(128),
	`depositPerGuest` decimal(8,2) NOT NULL DEFAULT '5.00',
	`maxGroupSize` int NOT NULL DEFAULT 20,
	`minAdvanceHours` int NOT NULL DEFAULT 2,
	`maxAdvanceDays` int NOT NULL DEFAULT 60,
	`cancellationHours` int NOT NULL DEFAULT 24,
	`cancellationPolicy` text,
	`legalText` text,
	`operativeEmail` varchar(320),
	`acceptsOnlineBooking` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restaurants_id` PRIMARY KEY(`id`),
	CONSTRAINT `restaurants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityType` enum('hotel','spa') NOT NULL,
	`entityId` int NOT NULL,
	`authorName` varchar(256) NOT NULL,
	`authorEmail` varchar(320),
	`rating` int NOT NULL,
	`title` varchar(256),
	`body` text NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`adminReply` text,
	`adminRepliedAt` timestamp,
	`stayDate` varchar(10),
	`verifiedBooking` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','monitor','agente','adminrest') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `room_types` ADD `internalTags` json DEFAULT ('[]');