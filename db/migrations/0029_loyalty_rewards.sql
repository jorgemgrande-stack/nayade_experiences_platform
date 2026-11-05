-- Big Elephant — Social Token Net · Tokens internos: recompensas y canjes (aditiva, BD de cada empresa).
--
-- `loyalty_rewards`: catálogo de recompensas de la empresa (coste en puntos, unidades disponibles, límite por cliente y
-- periodo, días de validez del código y vigencia).
-- `loyalty_redemptions`: canjes. Cada canje descuenta los puntos (movimiento «canje» del libro) y genera un código de
-- un solo uso (code, único) que el personal valida en el TPV o en el mostrador. Estados: emitido, usado, anulado
-- (devuelve los puntos) y caducado (código no usado a tiempo: devuelve los puntos). idem_key única: un mismo canje
-- nunca se registra dos veces (doble clic o reenvío del formulario).
-- `loyalty_redemption_checks`: registro de cada validación en mostrador (también las fallidas), sin el código
-- completo (solo su huella).
--
-- Solo crea tablas nuevas. Sin la extensión contratada no se usan. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id                INT           NOT NULL AUTO_INCREMENT,
  name              VARCHAR(120)  NOT NULL,
  description       VARCHAR(500)  NULL DEFAULT NULL,
  cost_points       INT           NOT NULL,
  stock             INT           NULL DEFAULT NULL,
  per_client_limit  INT           NULL DEFAULT NULL,
  limit_period      VARCHAR(16)   NULL DEFAULT NULL,
  code_valid_days   INT           NOT NULL DEFAULT 30,
  active            TINYINT(1)    NOT NULL DEFAULT 1,
  starts_at         BIGINT        NULL DEFAULT NULL,
  ends_at           BIGINT        NULL DEFAULT NULL,
  created_at        BIGINT        NOT NULL,
  updated_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_loyalty_rewards_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  reward_id      INT           NOT NULL,
  client_id      INT           NOT NULL,
  ledger_id      BIGINT        NOT NULL,
  points         INT           NOT NULL,
  code           VARCHAR(16)   NOT NULL,
  status         VARCHAR(12)   NOT NULL DEFAULT 'emitido',
  expires_at     BIGINT        NOT NULL,
  used_at        BIGINT        NULL DEFAULT NULL,
  used_by_id     INT           NULL DEFAULT NULL,
  used_by_name   VARCHAR(200)  NULL DEFAULT NULL,
  closed_at      BIGINT        NULL DEFAULT NULL,
  close_reason   VARCHAR(300)  NULL DEFAULT NULL,
  channel        VARCHAR(12)   NOT NULL DEFAULT 'cliente',
  idem_key       VARCHAR(160)  NOT NULL,
  created_by     VARCHAR(200)  NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loyalty_redemptions_code (code),
  UNIQUE KEY uq_loyalty_redemptions_idem (idem_key),
  KEY idx_loyalty_redemptions_reward (reward_id, status, client_id),
  KEY idx_loyalty_redemptions_client (client_id, created_at),
  KEY idx_loyalty_redemptions_expiry (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_redemption_checks (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  redemption_id    BIGINT        NULL DEFAULT NULL,
  code_hint        VARCHAR(16)   NULL DEFAULT NULL,
  result           VARCHAR(16)   NOT NULL,
  user_id          INT           NULL DEFAULT NULL,
  user_name        VARCHAR(200)  NULL DEFAULT NULL,
  created_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_loyalty_redemption_checks_created (created_at),
  KEY idx_loyalty_redemption_checks_redemption (redemption_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
