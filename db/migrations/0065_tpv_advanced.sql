-- TPV Advanced (Elephant Connect, capacidad `pos-advanced`), sobre la caja del plan. Aditiva, BD de cada empresa.
--
-- `tpv_adv_counts`: arqueos (intermedios o de cierre) con el recuento por billetes y monedas y la conciliación por
--   método (efectivo, tarjeta, Bizum, otros) frente a lo esperado. INMUTABLES: nunca se actualizan ni se borran; no
--   modifican el cierre ni `tpv_session_closures`.
-- `tpv_adv_shifts`: turnos de operador dentro de una sesión de caja (quién, inicio y fin, efectivo al empezar y al
--   acabar). Una caja cerrada no admite turnos nuevos.
-- `tpv_adv_handovers`: entrega y recepción de caja entre operadores (declarado, recibido, diferencia, estado).
--   Idempotente por la clave de cada intento. Una caja cerrada no admite entregas nuevas.
-- `tpv_adv_auth_rules`: operaciones sensibles que la empresa somete a autorización y su umbral.
-- `tpv_adv_authorizations`: solicitudes y decisiones de autorización de un supervisor (trazadas, idempotentes).
-- `tpv_adv_corrections`: correcciones trazables de un arqueo, un turno o una entrega: el registro original no cambia.
--
-- Solo crea tablas. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS tpv_adv_counts (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  session_id        INT           NOT NULL,
  register_id       INT           NOT NULL,
  shift_id          INT UNSIGNED  NULL,
  kind              VARCHAR(16)   NOT NULL,
  denominations     TEXT          NOT NULL,
  counted_cash      DECIMAL(10,2) NOT NULL,
  expected_cash     DECIMAL(10,2) NOT NULL,
  cash_difference   DECIMAL(10,2) NOT NULL,
  declared_card     DECIMAL(10,2) NULL,
  expected_card     DECIMAL(10,2) NOT NULL,
  card_difference   DECIMAL(10,2) NULL,
  declared_bizum    DECIMAL(10,2) NULL,
  expected_bizum    DECIMAL(10,2) NOT NULL,
  bizum_difference  DECIMAL(10,2) NULL,
  declared_other    DECIMAL(10,2) NULL,
  expected_other    DECIMAL(10,2) NOT NULL,
  other_difference  DECIMAL(10,2) NULL,
  notes             VARCHAR(500)  NULL,
  created_by        INT           NULL,
  created_by_name   VARCHAR(200)  NULL,
  idempotency_key   VARCHAR(64)   NOT NULL,
  created_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_adv_counts_key (idempotency_key),
  KEY idx_tpv_adv_counts_session (session_id),
  KEY idx_tpv_adv_counts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_adv_shifts (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  session_id        INT           NOT NULL,
  register_id       INT           NOT NULL,
  operator_user_id  INT           NOT NULL,
  operator_name     VARCHAR(200)  NOT NULL,
  status            VARCHAR(16)   NOT NULL,
  opening_cash      DECIMAL(10,2) NOT NULL,
  closing_cash      DECIMAL(10,2) NULL,
  started_at        BIGINT        NOT NULL,
  ended_at          BIGINT        NULL,
  started_by        INT           NULL,
  ended_by          INT           NULL,
  notes             VARCHAR(500)  NULL,
  start_key         VARCHAR(64)   NOT NULL,
  end_key           VARCHAR(64)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_adv_shifts_start_key (start_key),
  UNIQUE KEY uq_tpv_adv_shifts_end_key (end_key),
  KEY idx_tpv_adv_shifts_session (session_id, status),
  KEY idx_tpv_adv_shifts_operator (operator_user_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_adv_handovers (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  session_id        INT           NOT NULL,
  register_id       INT           NOT NULL,
  status            VARCHAR(16)   NOT NULL,
  from_user_id      INT           NOT NULL,
  from_name         VARCHAR(200)  NOT NULL,
  from_shift_id     INT UNSIGNED  NULL,
  to_user_id        INT           NULL,
  to_name           VARCHAR(200)  NULL,
  to_shift_id       INT UNSIGNED  NULL,
  declared_cash     DECIMAL(10,2) NOT NULL,
  received_cash     DECIMAL(10,2) NULL,
  difference        DECIMAL(10,2) NULL,
  declared_notes    VARCHAR(500)  NULL,
  received_notes    VARCHAR(500)  NULL,
  declared_at       BIGINT        NOT NULL,
  received_at       BIGINT        NULL,
  cancelled_at      BIGINT        NULL,
  cancelled_by      INT           NULL,
  idempotency_key   VARCHAR(64)   NOT NULL,
  receive_key       VARCHAR(64)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_adv_handovers_key (idempotency_key),
  UNIQUE KEY uq_tpv_adv_handovers_receive_key (receive_key),
  KEY idx_tpv_adv_handovers_session (session_id, status),
  KEY idx_tpv_adv_handovers_declared (declared_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_adv_auth_rules (
  kind              VARCHAR(32)   NOT NULL,
  enabled           TINYINT(1)    NOT NULL DEFAULT 0,
  threshold         DECIMAL(10,2) NULL,
  updated_by        INT           NULL,
  updated_by_name   VARCHAR(200)  NULL,
  updated_at        BIGINT        NOT NULL,
  PRIMARY KEY (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_adv_authorizations (
  id                 INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kind               VARCHAR(32)   NOT NULL,
  status             VARCHAR(16)   NOT NULL,
  session_id         INT           NULL,
  amount             DECIMAL(10,2) NULL,
  threshold          DECIMAL(10,2) NULL,
  reference          VARCHAR(120)  NULL,
  reason             VARCHAR(500)  NOT NULL,
  requested_by       INT           NOT NULL,
  requested_by_name  VARCHAR(200)  NOT NULL,
  requested_at       BIGINT        NOT NULL,
  decided_by         INT           NULL,
  decided_by_name    VARCHAR(200)  NULL,
  decided_at         BIGINT        NULL,
  decision_note      VARCHAR(500)  NULL,
  used_at            BIGINT        NULL,
  used_ref           VARCHAR(120)  NULL,
  idempotency_key    VARCHAR(64)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_adv_authorizations_key (idempotency_key),
  KEY idx_tpv_adv_authorizations_status (status, requested_at),
  KEY idx_tpv_adv_authorizations_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tpv_adv_corrections (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  target_kind       VARCHAR(16)   NOT NULL,
  target_id         INT UNSIGNED  NOT NULL,
  session_id        INT           NOT NULL,
  amount            DECIMAL(10,2) NULL,
  reason            VARCHAR(500)  NOT NULL,
  created_by        INT           NULL,
  created_by_name   VARCHAR(200)  NULL,
  idempotency_key   VARCHAR(64)   NOT NULL,
  created_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpv_adv_corrections_key (idempotency_key),
  KEY idx_tpv_adv_corrections_target (target_kind, target_id),
  KEY idx_tpv_adv_corrections_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
