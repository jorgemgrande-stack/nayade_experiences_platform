CREATE TABLE `page_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pageSlug` varchar(256) NOT NULL,
	`blockType` varchar(64) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`data` json NOT NULL,
	`isVisible` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `page_blocks_id` PRIMARY KEY(`id`)
);
