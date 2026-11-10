-- Caja de Business y Enterprise (estrategia TPV aprobada el 09/11/2026). Aditiva, BD de cada empresa.
--
-- `tpv_register_operators`: operadores asignados a cada caja (Business). Con alguno asignado, solo ellos (y la
--   administración del TPV) abren, cobran, mueven efectivo y cierran esa caja. `role` = operator | supervisor
--   (supervisor por caja: gestión avanzada de permisos de Enterprise; autoriza devoluciones y anulaciones de su caja).
--   Retirar una asignación la marca con `removed_at` (nunca se borra).
-- `tpv_return_requests`: devoluciones y anulaciones autorizadas (Business): el operador la pide con motivo; un
--   supervisor la aprueba (y se ejecuta) o la rechaza. Clave única por intento (idempotencia) y como mucho una
--   solicitud pendiente por venta.
--
-- `tpv_session_corrections.fin_movement_id`: movimiento de ajuste de la caja contable (fin_cash_movements) que refleja
--   cada corrección de una caja cerrada (enlazado a ella, con su motivo y autor). NULL = aún sin reflejar.
--
-- Solo crea tablas y añade una columna nula. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS tpv_register_operators (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  register_id      INT           NOT NULL,
  user_id          INT           NOT NULL,
  role             VARCHAR(16)   NOT NULL DEFAULT 'operator',
  created_by       INT           NULL,
  created_at       BIGINT        NOT NULL,
  removed_by       INT           NULL,
  removed_at       BIGINT        NULL,
  active_key       VARCHAR(40)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_register_operators_active (active_key),
  KEY idx_tpv_register_operators_register (register_id),
  KEY idx_tpv_register_operators_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_return_requests (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  sale_id          INT           NOT NULL,
  session_id       INT           NOT NULL,
  register_id      INT           NOT NULL,
  action           VARCHAR(16)   NOT NULL,
  amount           DECIMAL(10,2) NOT NULL,
  reason           VARCHAR(500)  NOT NULL,
  status           VARCHAR(16)   NOT NULL DEFAULT 'pending',
  requested_by     INT           NULL,
  requested_by_name VARCHAR(200) NULL,
  decided_by       INT           NULL,
  decided_by_name  VARCHAR(200)  NULL,
  decision_notes   VARCHAR(500)  NULL,
  decided_at       BIGINT        NULL,
  idempotency_key  VARCHAR(64)   NOT NULL,
  pending_key      VARCHAR(40)   NULL,
  created_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_return_requests_key (idempotency_key),
  UNIQUE KEY uq_tpv_return_requests_pending (pending_key),
  KEY idx_tpv_return_requests_status (status, register_id),
  KEY idx_tpv_return_requests_sale (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE tpv_session_corrections
  ADD COLUMN fin_movement_id INT NULL DEFAULT NULL;

