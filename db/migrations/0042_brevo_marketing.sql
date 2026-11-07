-- Elephant Connect · Brevo marketing (server/brevoMarketing): consentimiento de marketing por cliente del CRM con su
-- historial inmutable, ajustes de la conexión con la cuenta de Brevo PROPIA de la empresa (la clave va en la bóveda,
-- proveedor brevo_marketing), ejecuciones de sincronización y estado por contacto. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS customer_marketing_consents (
  client_id    INT          NOT NULL,
  status       VARCHAR(16)  NOT NULL,
  source       VARCHAR(64)  NOT NULL,
  evidence     VARCHAR(500) NULL,
  granted_at   TIMESTAMP(3) NULL,
  withdrawn_at TIMESTAMP(3) NULL,
  updated_by   VARCHAR(100) NOT NULL,
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (client_id),
  KEY idx_customer_marketing_consents_status (status, updated_at),
  CONSTRAINT chk_customer_marketing_consents_status CHECK (status IN ('granted', 'withdrawn'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_marketing_consent_log (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id       INT          NOT NULL,
  previous_status VARCHAR(16)  NULL,
  new_status      VARCHAR(16)  NOT NULL,
  source          VARCHAR(64)  NOT NULL,
  evidence        VARCHAR(500) NULL,
  actor           VARCHAR(100) NOT NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_customer_marketing_consent_log_client (client_id, id),
  KEY idx_customer_marketing_consent_log_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS brevo_marketing_settings (
  id              TINYINT UNSIGNED NOT NULL,
  list_id         INT UNSIGNED NULL,
  list_name       VARCHAR(200) NULL,
  auto_sync       TINYINT(1)   NOT NULL DEFAULT 0,
  connected_at    TIMESTAMP(3) NULL,
  disconnected_at TIMESTAMP(3) NULL,
  updated_by      VARCHAR(100) NULL,
  updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_brevo_marketing_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS brevo_sync_runs (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  trigger_kind  VARCHAR(16)  NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'running',
  list_id       INT UNSIGNED NULL,
  api_calls     INT UNSIGNED NOT NULL DEFAULT 0,
  exported      INT UNSIGNED NOT NULL DEFAULT 0,
  removed       INT UNSIGNED NOT NULL DEFAULT 0,
  unsubscribed  INT UNSIGNED NOT NULL DEFAULT 0,
  skipped       INT UNSIGNED NOT NULL DEFAULT 0,
  errors        INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  retry_of      INT UNSIGNED NULL,
  actor         VARCHAR(100) NULL,
  started_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   TIMESTAMP(3) NULL,
  -- Una sola ejecución en curso por empresa: garantía en la propia BD
  running_slot  TINYINT UNSIGNED GENERATED ALWAYS AS (IF(status = 'running', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_brevo_sync_runs_running (running_slot),
  KEY idx_brevo_sync_runs_started (started_at),
  CONSTRAINT chk_brevo_sync_runs_status CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  CONSTRAINT chk_brevo_sync_runs_trigger CHECK (trigger_kind IN ('manual', 'job', 'retry'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS brevo_contact_sync (
  client_id        INT          NOT NULL,
  email_normalized VARCHAR(320) NOT NULL,
  status           VARCHAR(16)  NOT NULL,
  last_synced_at   TIMESTAMP(3) NULL,
  last_error       VARCHAR(300) NULL,
  last_run_id      INT UNSIGNED NULL,
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (client_id),
  KEY idx_brevo_contact_sync_status (status),
  KEY idx_brevo_contact_sync_email (email_normalized),
  CONSTRAINT chk_brevo_contact_sync_status CHECK (status IN ('synced', 'removed', 'error'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
