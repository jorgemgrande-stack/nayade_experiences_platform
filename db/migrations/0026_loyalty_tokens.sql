-- Big Elephant — Social Token Net · Tokens internos (aditiva, BD de cada empresa; capacidad social-token-net-tokens).
--
-- `loyalty_program`: configuración del programa (una fila, id = 1): activo, nombre de los puntos, equivalencia
-- orientativa y caducidad de los puntos emitidos.
-- `loyalty_wallets`: un monedero por cliente del CRM (clients.id); saldo y acumulados. Solo lo modifica el libro.
-- `loyalty_ledger`: libro auditable e inmutable de movimientos (emisión, canje, ajuste, anulación y caducidad) con
-- saldo resultante, documento origen, regla, campaña, usuario y fecha. idem_key única: un mismo documento nunca se
-- aplica dos veces (cobro repetido, notificación de pago duplicada o doble clic en el panel).
-- `loyalty_rules`: reglas para ganar puntos (por compra: importe, producto o categoría; por acciones permitidas).
-- `loyalty_campaigns`: campañas con multiplicador o bonificación, vigencia, presupuesto y límite por cliente y periodo.
--
-- Solo crea tablas nuevas. Sin la extensión contratada no se usan. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS loyalty_program (
  id              INT           NOT NULL,
  enabled         TINYINT(1)    NOT NULL DEFAULT 0,
  points_name     VARCHAR(40)   NOT NULL DEFAULT 'puntos',
  eq_points       INT           NULL DEFAULT NULL,
  eq_euros        DECIMAL(10,2) NULL DEFAULT NULL,
  expiry_months   INT           NULL DEFAULT NULL,
  updated_at      BIGINT        NOT NULL,
  updated_by      VARCHAR(200)  NULL DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_wallets (
  id               INT          NOT NULL AUTO_INCREMENT,
  client_id        INT          NOT NULL,
  balance          INT          NOT NULL DEFAULT 0,
  lifetime_earned  INT          NOT NULL DEFAULT 0,
  lifetime_spent   INT          NOT NULL DEFAULT 0,
  created_at       BIGINT       NOT NULL,
  updated_at       BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loyalty_wallets_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  wallet_id        INT           NOT NULL,
  client_id        INT           NOT NULL,
  kind             VARCHAR(16)   NOT NULL,
  direction        VARCHAR(8)    NOT NULL,
  amount           INT           NOT NULL,
  balance_after    INT           NOT NULL,
  campaign_points  INT           NOT NULL DEFAULT 0,
  reason           VARCHAR(300)  NULL DEFAULT NULL,
  source_type      VARCHAR(24)   NULL DEFAULT NULL,
  source_id        VARCHAR(64)   NULL DEFAULT NULL,
  source_ref       VARCHAR(100)  NULL DEFAULT NULL,
  rule_id          INT           NULL DEFAULT NULL,
  campaign_id      INT           NULL DEFAULT NULL,
  reverses_id      BIGINT        NULL DEFAULT NULL,
  expires_at       BIGINT        NULL DEFAULT NULL,
  idem_key         VARCHAR(160)  NULL DEFAULT NULL,
  metadata         JSON          NULL,
  user_id          INT           NULL DEFAULT NULL,
  user_name        VARCHAR(200)  NULL DEFAULT NULL,
  created_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loyalty_ledger_idem (idem_key),
  KEY idx_loyalty_ledger_client (client_id, created_at),
  KEY idx_loyalty_ledger_source (source_type, source_id),
  KEY idx_loyalty_ledger_campaign (campaign_id, client_id, created_at),
  KEY idx_loyalty_ledger_rule (rule_id, client_id, created_at),
  KEY idx_loyalty_ledger_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_rules (
  id             INT            NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120)   NOT NULL,
  trigger_kind   VARCHAR(16)    NOT NULL DEFAULT 'purchase',
  action_key     VARCHAR(32)    NULL DEFAULT NULL,
  scope          VARCHAR(16)    NOT NULL DEFAULT 'all',
  scope_id       INT            NULL DEFAULT NULL,
  calc           VARCHAR(16)    NOT NULL DEFAULT 'per_euro',
  rate           DECIMAL(10,4)  NULL DEFAULT NULL,
  fixed_points   INT            NULL DEFAULT NULL,
  min_spend      DECIMAL(10,2)  NULL DEFAULT NULL,
  max_points     INT            NULL DEFAULT NULL,
  limit_count    INT            NULL DEFAULT NULL,
  limit_period   VARCHAR(16)    NULL DEFAULT NULL,
  priority       INT            NOT NULL DEFAULT 0,
  active         TINYINT(1)     NOT NULL DEFAULT 1,
  starts_at      BIGINT         NULL DEFAULT NULL,
  ends_at        BIGINT         NULL DEFAULT NULL,
  created_at     BIGINT         NOT NULL,
  updated_at     BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_loyalty_rules_active (active, trigger_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id                INT            NOT NULL AUTO_INCREMENT,
  name              VARCHAR(120)   NOT NULL,
  scope             VARCHAR(16)    NOT NULL DEFAULT 'all',
  scope_id          INT            NULL DEFAULT NULL,
  multiplier        DECIMAL(6,2)   NULL DEFAULT NULL,
  bonus_points      INT            NULL DEFAULT NULL,
  budget_points     INT            NULL DEFAULT NULL,
  per_client_limit  INT            NULL DEFAULT NULL,
  limit_period      VARCHAR(16)    NULL DEFAULT NULL,
  priority          INT            NOT NULL DEFAULT 0,
  active            TINYINT(1)     NOT NULL DEFAULT 1,
  starts_at         BIGINT         NULL DEFAULT NULL,
  ends_at           BIGINT         NULL DEFAULT NULL,
  created_at        BIGINT         NOT NULL,
  updated_at        BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_loyalty_campaigns_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
