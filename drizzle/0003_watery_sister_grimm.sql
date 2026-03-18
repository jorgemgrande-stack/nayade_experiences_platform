ALTER TABLE `users` ADD `passwordHash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `inviteToken` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `inviteTokenExpiry` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `inviteAccepted` boolean DEFAULT false NOT NULL;