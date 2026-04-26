CREATE TABLE `onboarding_status` (
  `id` int AUTO_INCREMENT NOT NULL,
  `organization_id` int NOT NULL,
  `business_info_completed` boolean NOT NULL DEFAULT false,
  `fiscal_completed` boolean NOT NULL DEFAULT false,
  `branding_completed` boolean NOT NULL DEFAULT false,
  `emails_completed` boolean NOT NULL DEFAULT false,
  `modules_completed` boolean NOT NULL DEFAULT false,
  `integrations_reviewed` boolean NOT NULL DEFAULT false,
  `completed_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `onboarding_status_id` PRIMARY KEY(`id`),
  CONSTRAINT `onboarding_status_org_unique` UNIQUE(`organization_id`)
);
--> statement-breakpoint
INSERT IGNORE INTO `onboarding_status`
  (`organization_id`, `business_info_completed`, `fiscal_completed`, `branding_completed`, `emails_completed`, `modules_completed`, `integrations_reviewed`, `completed_at`)
VALUES (1, true, true, true, true, true, true, NOW());
