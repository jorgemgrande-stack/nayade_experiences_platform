-- Garantía en la BD: como mucho UN precio vigente (approved) por producto, tipo, moneda y unidad.
-- La aprobación ya es transaccional en el código; este índice impide que cualquier otra ruta
-- (o un fallo futuro) deje dos precios vigentes a la vez.
--
-- Antes de aplicar, comprobar que no hay duplicados vigentes (si los hay, la migración falla sin
-- cambiar nada y hay que retirar a mano el sobrante, que queda en el historial):
--   SELECT entry_id, kind, currency, unit, COUNT(*) FROM web_prices
--    WHERE status = 'approved' GROUP BY entry_id, kind, currency, unit HAVING COUNT(*) > 1;
ALTER TABLE web_prices
  ADD COLUMN approved_slot VARCHAR(80)
    GENERATED ALWAYS AS (IF(status = 'approved', CONCAT(kind, '|', currency, '|', IFNULL(unit, '')), NULL)) STORED,
  ADD UNIQUE KEY uq_web_price_approved (entry_id, approved_slot);
