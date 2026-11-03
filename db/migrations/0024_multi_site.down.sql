-- Reversión de 0024_multi_site: las cajas, sesiones y ventas pierden su sede (todo vuelve a la principal) y los usuarios
-- vuelven a trabajar en todas las sedes. Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS user_sites;

ALTER TABLE tpv_sales
  DROP KEY idx_tpv_sales_site,
  DROP COLUMN site_id;

ALTER TABLE cash_sessions
  DROP KEY idx_cash_sessions_site,
  DROP COLUMN site_id;

ALTER TABLE cash_registers
  DROP COLUMN site_id;
