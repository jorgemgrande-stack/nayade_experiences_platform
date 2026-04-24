ALTER TABLE `bank_movements` ADD COLUMN `conciliation_status` ENUM('pendiente','conciliado') NOT NULL DEFAULT 'pendiente';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bank_movement_links` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `bank_movement_id` INT NOT NULL,
  `entity_type` ENUM('quote','reservation','invoice','expense') NOT NULL,
  `entity_id` INT NOT NULL,
  `link_type` ENUM('income_transfer','card_income','cash_income','expense_payment') NOT NULL DEFAULT 'income_transfer',
  `amount_linked` DECIMAL(12,2) NOT NULL,
  `status` ENUM('proposed','confirmed','rejected','unlinked') NOT NULL DEFAULT 'proposed',
  `confidence_score` INT DEFAULT 0,
  `matched_by` VARCHAR(255),
  `matched_at` TIMESTAMP NULL,
  `rejected_at` TIMESTAMP NULL,
  `unlinked_at` TIMESTAMP NULL,
  `notes` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
