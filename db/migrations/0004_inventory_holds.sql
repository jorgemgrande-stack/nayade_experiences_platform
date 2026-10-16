-- Retención de plazas de spa y hotel (corrección de la sobreventa). La reserva guarda el recurso que
-- ocupa (franja de spa o tipo de habitación + rango de noches), cuántas plazas y el estado de la retención.
-- Aditiva: solo columnas NULL y un índice en `reservations`; las reservas existentes quedan sin recurso
-- (NULL) y no cuentan en la ocupación calculada. En MySQL 8 las columnas al final se añaden en INSTANT.
ALTER TABLE reservations
  ADD COLUMN inventory_kind      VARCHAR(16) NULL,
  ADD COLUMN inventory_ref_id    INT         NULL,
  ADD COLUMN inventory_units     INT         NULL,
  ADD COLUMN stay_check_in       VARCHAR(10) NULL,
  ADD COLUMN stay_check_out      VARCHAR(10) NULL,
  ADD COLUMN hold_status         VARCHAR(16) NULL,
  ADD COLUMN hold_expires_at     BIGINT      NULL,
  ADD COLUMN hold_release_reason VARCHAR(32) NULL;
CREATE INDEX idx_reservations_inventory ON reservations (inventory_kind, inventory_ref_id, hold_status);
