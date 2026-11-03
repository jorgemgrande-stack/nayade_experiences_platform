-- Big Elephant — Varias sedes (aditiva, BD de cada empresa; capacidad Business multi-site).
--
-- Las sedes viven en el registro del plano de control (tenant_sites): aquí solo se etiquetan los datos con el id de
-- la sede. NULL = sede principal: todo lo existente queda en la principal sin migrar datos.
-- `cash_registers.site_id`: sede de cada caja.
-- `cash_sessions.site_id`: sede de la caja al abrir la sesión (se conserva aunque la caja cambie de sede).
-- `tpv_sales.site_id`: sede de la venta (la de su sesión), para filtrar ventas e informes de caja por sede.
-- `user_sites`: sedes en las que trabaja cada usuario. Sin filas, el usuario trabaja en todas (lo de siempre).
--
-- Solo añade columnas nulas, índices y una tabla nueva y vacía. Nunca se ejecuta al arrancar.

ALTER TABLE cash_registers
  ADD COLUMN site_id VARCHAR(63) NULL DEFAULT NULL;

ALTER TABLE cash_sessions
  ADD COLUMN site_id VARCHAR(63) NULL DEFAULT NULL,
  ADD KEY idx_cash_sessions_site (site_id);

ALTER TABLE tpv_sales
  ADD COLUMN site_id VARCHAR(63) NULL DEFAULT NULL,
  ADD KEY idx_tpv_sales_site (site_id);

CREATE TABLE IF NOT EXISTS user_sites (
  user_id     INT          NOT NULL,
  site_id     VARCHAR(63)  NOT NULL,
  created_at  BIGINT       NOT NULL,
  PRIMARY KEY (user_id, site_id),
  KEY idx_user_sites_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
