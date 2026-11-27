-- Newsletter (Elephant Core · server/newsletter): suscripción pública con doble confirmación, independiente del contacto
-- general del CRM. Solo CREATE TABLE (aditiva, sin tocar datos existentes). Nunca se ejecuta al arrancar.
--
-- newsletter_subscribers : una fila por correo (único). Estado pending → active → unsubscribed. Guarda el texto legal y la
--                          versión aceptados, la fecha, la huella de la IP (nunca la IP) y el HASH del enlace de
--                          confirmación (nunca el enlace). client_id enlaza con el cliente del CRM (consentimiento de marketing).
-- newsletter_events      : historial inmutable del consentimiento y de los cambios (quién, cuándo, qué texto).
-- newsletter_mail_log    : cada correo (confirmación, bienvenida) con su clave de idempotencia ÚNICA y su resultado.
-- newsletter_exports     : quién exportó, cuándo, en qué formato y con qué filtros (sin los datos exportados).
-- newsletter_settings    : ajustes de la empresa (singleton). `enabled` = 0 por defecto: ninguna empresa lo tiene activo.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email                VARCHAR(254) NOT NULL,
  status               VARCHAR(16)  NOT NULL DEFAULT 'pending',
  locale               VARCHAR(8)   NOT NULL DEFAULT 'de',
  source               VARCHAR(64)  NOT NULL DEFAULT 'web',
  page                 VARCHAR(200) NULL,
  client_id            INT          NULL,
  consent_text         VARCHAR(600) NULL,
  consent_version      VARCHAR(16)  NULL,
  consent_at           BIGINT       NULL,
  ip_hash              CHAR(64)     NULL,
  confirm_token_hash   CHAR(64)     NULL,
  confirm_expires_at   BIGINT       NULL,
  confirm_sent_count   INT UNSIGNED NOT NULL DEFAULT 0,
  last_confirm_sent_at BIGINT       NULL,
  confirmed_at         BIGINT       NULL,
  unsubscribed_at      BIGINT       NULL,
  unsubscribed_by      VARCHAR(100) NULL,
  welcome_sent_at      BIGINT       NULL,
  crm_sync_error       VARCHAR(300) NULL,
  created_at           BIGINT       NOT NULL,
  updated_at           BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_newsletter_subscribers_email (email),
  UNIQUE KEY uq_newsletter_subscribers_token (confirm_token_hash),
  KEY idx_newsletter_subscribers_status (status, created_at),
  KEY idx_newsletter_subscribers_client (client_id),
  CONSTRAINT chk_newsletter_subscribers_status CHECK (status IN ('pending', 'active', 'unsubscribed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS newsletter_events (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscriber_id   INT UNSIGNED NOT NULL,
  action          VARCHAR(32)  NOT NULL,
  consent_text    VARCHAR(600) NULL,
  consent_version VARCHAR(16)  NULL,
  ip_hash         CHAR(64)     NULL,
  actor           VARCHAR(100) NOT NULL,
  detail          VARCHAR(300) NULL,
  created_at      BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_newsletter_events_subscriber (subscriber_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS newsletter_mail_log (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscriber_id   INT UNSIGNED NOT NULL,
  kind            VARCHAR(16)  NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'sending',
  error           VARCHAR(300) NULL,
  created_at      BIGINT       NOT NULL,
  finished_at     BIGINT       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_newsletter_mail_log_key (idempotency_key),
  KEY idx_newsletter_mail_log_subscriber (subscriber_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS newsletter_exports (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id   INT          NOT NULL,
  actor      VARCHAR(120) NOT NULL,
  format     VARCHAR(8)   NOT NULL,
  row_count  INT UNSIGNED NOT NULL,
  filters    VARCHAR(600) NOT NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_newsletter_exports_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS newsletter_settings (
  id             TINYINT UNSIGNED NOT NULL,
  enabled        TINYINT(1) NOT NULL DEFAULT 0,
  public_enabled TINYINT(1) NOT NULL DEFAULT 1,
  templates_json MEDIUMTEXT NULL,
  updated_by     VARCHAR(100) NULL,
  updated_at     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT chk_newsletter_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
