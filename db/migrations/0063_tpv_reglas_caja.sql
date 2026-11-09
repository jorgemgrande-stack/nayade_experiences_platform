-- Caja (TPV) por plan, reglas de funcionamiento (estrategia TPV aprobada el 09/11/2026). Aditiva, BD de cada empresa.
--
-- `cash_registers.cutoff_time`: hora de corte operativo propia de la caja (HH:MM). NULL = la de la empresa
--   (ajuste `tpv_cutoff_time`, por defecto 00:00 en su zona horaria).
-- `cash_movements.idempotency_key`, `cash_sessions.open_key` y `close_key`: clave del intento (la genera el TPV). Un
--   reintento o un doble clic con la misma clave no duplica el movimiento, la apertura ni el cierre. NULL no colisiona.
-- `tpv_session_closures`: foto INMUTABLE de cada cierre (se escribe una vez al cerrar; el código nunca la actualiza
--   ni la borra).
-- `tpv_session_corrections`: correcciones trazables de una caja YA cerrada (entrada, salida o ajuste del recuento),
--   con motivo, autor y clave; se registran aparte y nunca modifican el cierre.
--
-- Solo añade columnas nulas, índices y tablas. Nunca se ejecuta al arrancar.

ALTER TABLE cash_registers
  ADD COLUMN cutoff_time CHAR(5) NULL DEFAULT NULL;

ALTER TABLE cash_movements
  ADD COLUMN idempotency_key VARCHAR(64) NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_cash_movements_idempotency_key (idempotency_key);

ALTER TABLE cash_sessions
  ADD COLUMN open_key VARCHAR(64) NULL DEFAULT NULL,
  ADD COLUMN close_key VARCHAR(64) NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_cash_sessions_open_key (open_key),
  ADD UNIQUE KEY uq_cash_sessions_close_key (close_key);

CREATE TABLE IF NOT EXISTS tpv_session_closures (
  session_id       INT           NOT NULL,
  register_id      INT           NOT NULL,
  site_id          VARCHAR(63)   NULL,
  operational_day  CHAR(10)      NOT NULL,
  opening_amount   DECIMAL(10,2) NOT NULL,
  total_cash       DECIMAL(10,2) NOT NULL,
  total_card       DECIMAL(10,2) NOT NULL,
  total_bizum      DECIMAL(10,2) NOT NULL,
  total_mixed      DECIMAL(10,2) NOT NULL,
  manual_in        DECIMAL(10,2) NOT NULL,
  manual_out       DECIMAL(10,2) NOT NULL,
  expected_cash    DECIMAL(10,2) NOT NULL,
  counted_cash     DECIMAL(10,2) NOT NULL,
  difference       DECIMAL(10,2) NOT NULL,
  closed_by        INT           NULL,
  closed_by_name   VARCHAR(200)  NULL,
  opened_at        BIGINT        NOT NULL,
  closed_at        BIGINT        NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_tpv_session_closures_day (operational_day, register_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_session_corrections (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  session_id       INT           NOT NULL,
  kind             VARCHAR(16)   NOT NULL,
  amount           DECIMAL(10,2) NOT NULL,
  reason           VARCHAR(500)  NOT NULL,
  created_by       INT           NULL,
  created_by_name  VARCHAR(200)  NULL,
  idempotency_key  VARCHAR(64)   NOT NULL,
  created_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_session_corrections_key (idempotency_key),
  KEY idx_tpv_session_corrections_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
