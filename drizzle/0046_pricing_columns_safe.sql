-- Safe idempotent add of pricing columns (guards against 0045 partial failure)
ALTER TABLE `experiences`
  ADD COLUMN IF NOT EXISTS `pricing_type` ENUM('per_person','per_unit') NOT NULL DEFAULT 'per_person',
  ADD COLUMN IF NOT EXISTS `unit_capacity` INT NULL,
  ADD COLUMN IF NOT EXISTS `max_units` INT NULL;
--> statement-breakpoint
ALTER TABLE `reservations`
  ADD COLUMN IF NOT EXISTS `pricing_type` VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS `unit_capacity` INT NULL,
  ADD COLUMN IF NOT EXISTS `units_booked` INT NULL;
