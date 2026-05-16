ALTER TABLE `tpv_sale_items` ADD COLUMN IF NOT EXISTS `is_manual` tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE `tpv_sale_items` ADD COLUMN IF NOT EXISTS `concept_text` varchar(500) DEFAULT NULL;
