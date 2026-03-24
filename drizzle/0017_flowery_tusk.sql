ALTER TABLE `experiences` ADD `fiscalRegime` enum('reav','general_21','mixed') DEFAULT 'general_21' NOT NULL;--> statement-breakpoint
ALTER TABLE `experiences` ADD `productType` enum('own','semi_own','third_party') DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE `experiences` ADD `providerPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `experiences` ADD `agencyMarginPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `packs` ADD `fiscalRegime` enum('reav','general_21','mixed') DEFAULT 'general_21' NOT NULL;--> statement-breakpoint
ALTER TABLE `packs` ADD `productType` enum('own','semi_own','third_party') DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE `packs` ADD `providerPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `packs` ADD `agencyMarginPercent` decimal(5,2) DEFAULT '0';