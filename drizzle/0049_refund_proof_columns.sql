ALTER TABLE `cancellation_requests`
  ADD COLUMN IF NOT EXISTS `refund_executed_at` TIMESTAMP NULL AFTER `closed_at`,
  ADD COLUMN IF NOT EXISTS `refund_proof_url` VARCHAR(512) NULL AFTER `refund_executed_at`;
