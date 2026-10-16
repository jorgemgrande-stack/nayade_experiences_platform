-- Reversión de 0004_inventory_holds (se pierde qué franja/habitación retiene cada reserva; la ocupación
-- de spa sigue en spa_slots.bookedCount). Retirar antes el código que usa estas columnas.
DROP INDEX idx_reservations_inventory ON reservations;
ALTER TABLE reservations
  DROP COLUMN inventory_kind,
  DROP COLUMN inventory_ref_id,
  DROP COLUMN inventory_units,
  DROP COLUMN stay_check_in,
  DROP COLUMN stay_check_out,
  DROP COLUMN hold_status,
  DROP COLUMN hold_expires_at,
  DROP COLUMN hold_release_reason;
