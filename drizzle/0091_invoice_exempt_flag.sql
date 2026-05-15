ALTER TABLE `reservations` ADD COLUMN IF NOT EXISTS `invoice_exempt` tinyint(1) NOT NULL DEFAULT 0;
