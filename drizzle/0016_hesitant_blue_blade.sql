ALTER TABLE `experiences` ADD `discountPercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `experiences` ADD `discountExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `packs` ADD `discountPercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `packs` ADD `discountExpiresAt` timestamp;