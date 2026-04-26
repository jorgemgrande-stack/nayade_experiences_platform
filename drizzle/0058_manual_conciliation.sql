-- Ampliar entity_type para soportar conciliación manual
ALTER TABLE `bank_movement_links`
  MODIFY COLUMN `entity_type` enum('quote','reservation','invoice','expense','card_terminal_batch','manual') NOT NULL;

-- Ampliar link_type para el tipo de conciliación manual
ALTER TABLE `bank_movement_links`
  MODIFY COLUMN `link_type` enum('income_transfer','card_income','cash_income','expense_payment','manual_conciliation') NOT NULL DEFAULT 'income_transfer';
