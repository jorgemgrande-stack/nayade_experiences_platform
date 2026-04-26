CREATE TABLE `organizations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `status` enum('active','inactive','onboarding') NOT NULL DEFAULT 'onboarding',
  `owner_user_id` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
  CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
INSERT IGNORE INTO `organizations` (`name`, `slug`, `status`) VALUES ('Nayade Experiences', 'nayade-experiences', 'active');
