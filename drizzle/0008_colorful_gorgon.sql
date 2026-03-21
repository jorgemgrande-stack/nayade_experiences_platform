CREATE TABLE `gallery_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`imageUrl` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`title` varchar(256) DEFAULT '',
	`category` varchar(128) NOT NULL DEFAULT 'General',
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gallery_items_id` PRIMARY KEY(`id`)
);
