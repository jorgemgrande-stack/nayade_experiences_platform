CREATE TABLE `coupon_email_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`autoSendCouponReceived` boolean NOT NULL DEFAULT true,
	`autoSendCouponValidated` boolean NOT NULL DEFAULT true,
	`autoSendInternalAlert` boolean NOT NULL DEFAULT true,
	`emailMode` enum('per_submission','per_coupon') NOT NULL DEFAULT 'per_submission',
	`internalAlertEmail` varchar(320) NOT NULL DEFAULT 'reservas@nayadeexperiences.es',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coupon_email_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `submissionId` varchar(64);--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `originSource` enum('web','admin_manual_entry') DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `channelEntry` enum('web','email','whatsapp','telefono','presencial','manual') DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `coupon_redemptions` ADD `createdByAdminId` int;