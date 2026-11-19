-- Cobros con la cuenta Stripe de cada empresa (Stripe Connect). Aditiva, BD de cada empresa. Sin cobros activos.
--
-- payment_accounts: la cuenta Stripe que la empresa ha vinculado, UNA FILA POR MODO («test» = Prueba, «live» = Real).
--   Solo guarda el identificador de la cuenta (acct_…) y el estado leído de Stripe; nunca claves ni secretos (la
--   plataforma usa su propia clave de Connect y cabecera Stripe-Account). `online_enabled` es el interruptor de la
--   empresa: apagado por defecto y solo se enciende con la cuenta verificada (lo impone el servidor).
-- payment_events: eventos de Stripe ya recibidos por la empresa (clave = event.id). Un reintento o una repetición no
--   se aplica dos veces. `outcome` dice qué pasó (applied, duplicate, ignored, isolated…).
-- payment_checkouts: sesiones de Checkout creadas en la cuenta de la empresa para pagar un presupuesto. Importe y
--   moneda salen del presupuesto al crearla; `status` pasa a «paid» solo con el evento firmado, nunca por la
--   redirección del navegador.
--
-- Sin claves foráneas (como el resto de este carril). Tablas nuevas y vacías. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS payment_accounts (
  provider          VARCHAR(16)  NOT NULL DEFAULT 'stripe',
  mode              VARCHAR(8)   NOT NULL,
  account_id        VARCHAR(64)  NOT NULL,
  status            VARCHAR(16)  NOT NULL DEFAULT 'pendiente',
  charges_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  payouts_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  details_submitted TINYINT(1)   NOT NULL DEFAULT 0,
  requirements_due  TEXT         NULL,
  disabled_reason   VARCHAR(120) NULL,
  online_enabled    TINYINT(1)   NOT NULL DEFAULT 0,
  connected_at      BIGINT       NOT NULL,
  verified_at       BIGINT       NULL,
  last_event_id     VARCHAR(80)  NULL,
  last_event_type   VARCHAR(80)  NULL,
  last_event_at     BIGINT       NULL,
  updated_at        BIGINT       NOT NULL,
  updated_by        VARCHAR(160) NULL,
  PRIMARY KEY (provider, mode),
  UNIQUE KEY uq_payment_accounts_account (account_id),
  CONSTRAINT chk_payment_accounts_mode CHECK (mode IN ('test','live')),
  CONSTRAINT chk_payment_accounts_status CHECK (status IN ('no_conectada','pendiente','verificada','restringida'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_events (
  event_id     VARCHAR(80)  NOT NULL,
  account_id   VARCHAR(64)  NULL,
  mode         VARCHAR(8)   NOT NULL,
  type         VARCHAR(80)  NOT NULL,
  outcome      VARCHAR(24)  NOT NULL,
  received_at  BIGINT       NOT NULL,
  PRIMARY KEY (event_id),
  KEY idx_payment_events_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_checkouts (
  session_id        VARCHAR(80)  NOT NULL,
  provider          VARCHAR(16)  NOT NULL DEFAULT 'stripe',
  mode              VARCHAR(8)   NOT NULL,
  account_id        VARCHAR(64)  NOT NULL,
  quote_id          INT          NOT NULL,
  amount_cents      INT          NOT NULL,
  currency          VARCHAR(3)   NOT NULL,
  status            VARCHAR(12)  NOT NULL DEFAULT 'pending',
  payment_intent_id VARCHAR(80)  NULL,
  created_at        BIGINT       NOT NULL,
  paid_at           BIGINT       NULL,
  PRIMARY KEY (session_id),
  KEY idx_payment_checkouts_quote (quote_id, status),
  CONSTRAINT chk_payment_checkouts_status CHECK (status IN ('pending','paid','expired','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
