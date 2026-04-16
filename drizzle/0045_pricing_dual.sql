-- Pricing dual: per_person (default, retrocompatible) y per_unit (canoas, motos de agua, etc.)
-- Nuevos campos en experiences
ALTER TABLE `experiences`
  ADD COLUMN `pricing_type` ENUM('per_person','per_unit') NOT NULL DEFAULT 'per_person',
  ADD COLUMN `unit_capacity` INT NULL,
  ADD COLUMN `max_units` INT NULL;

-- Snapshot de pricing en reservations
ALTER TABLE `reservations`
  ADD COLUMN `pricing_type` VARCHAR(16) NULL,
  ADD COLUMN `unit_capacity` INT NULL,
  ADD COLUMN `units_booked` INT NULL;
