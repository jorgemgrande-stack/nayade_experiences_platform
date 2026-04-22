ALTER TABLE `cancellation_requests`
  ADD COLUMN IF NOT EXISTS `cancellation_scope` VARCHAR(10) NOT NULL DEFAULT 'total' AFTER `cancellation_number`,
  ADD COLUMN IF NOT EXISTS `cancelled_items_json` TEXT NULL AFTER `cancellation_scope`;
