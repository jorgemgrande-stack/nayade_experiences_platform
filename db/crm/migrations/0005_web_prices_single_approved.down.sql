-- Reversión de 0005_web_prices_single_approved (solo quita el índice y la columna generada; no toca datos).
ALTER TABLE web_prices
  DROP KEY uq_web_price_approved,
  DROP COLUMN approved_slot;
