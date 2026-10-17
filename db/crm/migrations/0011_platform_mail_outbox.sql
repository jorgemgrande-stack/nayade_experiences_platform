-- Big Elephant — correo de PLATAFORMA (Elephant Source): bandeja de salida, eventos y supresiones de los
-- avisos que envía el plano de control (prueba gratuita, contratación, pagos de prueba, impago, cancelación,
-- alta asistida). Aditiva; nunca se ejecuta al arrancar. Mismo formato que db/migrations/0010_mail_outbox
-- (un único código de acceso): cada fila lleva el `tenant_id` de la empresa a la que se refiere el aviso
-- («platform» si aún no tiene) y las supresiones son por empresa. Diseño: docs/runbooks/CORREO_BREVO.md.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id                   BIGINT        NOT NULL AUTO_INCREMENT,
  tenant_id            VARCHAR(63)   NOT NULL,
  idempotency_key      VARCHAR(160)  NOT NULL,
  category             VARCHAR(40)   NOT NULL,
  status               ENUM('pending','sending','accepted','delivered','soft_bounced','bounced','blocked','complained','failed','skipped') NOT NULL,
  reason               VARCHAR(60)   NULL,
  recipient_hash       CHAR(64)      NOT NULL,
  recipient_masked     VARCHAR(200)  NOT NULL,
  to_email             VARCHAR(320)  NULL,
  cc_json              JSON          NULL,
  sender_name          VARCHAR(120)  NOT NULL,
  sender_email         VARCHAR(320)  NOT NULL,
  reply_to             VARCHAR(320)  NULL,
  subject              VARCHAR(400)  NOT NULL,
  html_body            MEDIUMTEXT    NULL,
  text_body            MEDIUMTEXT    NULL,
  attachments_json     JSON          NULL,
  provider             VARCHAR(20)   NULL,
  provider_message_id  VARCHAR(200)  NULL,
  attempts             INT           NOT NULL DEFAULT 0,
  next_attempt_at      BIGINT        NULL,
  locked_until         BIGINT        NULL,
  last_error           VARCHAR(120)  NULL,
  created_at           BIGINT        NOT NULL,
  updated_at           BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_outbox_key (tenant_id, idempotency_key),
  KEY idx_mail_outbox_due (status, next_attempt_at),
  KEY idx_mail_outbox_recipient (tenant_id, recipient_hash, created_at),
  KEY idx_mail_outbox_tenant_created (tenant_id, created_at),
  KEY idx_mail_outbox_message (provider_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mail_events (
  id                 BIGINT        NOT NULL AUTO_INCREMENT,
  outbox_id          BIGINT        NOT NULL,
  tenant_id          VARCHAR(63)   NOT NULL,
  kind               VARCHAR(30)   NOT NULL,
  provider_event_id  VARCHAR(200)  NULL,
  detail             VARCHAR(200)  NULL,
  created_at         BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_events_provider (provider_event_id),
  KEY idx_mail_events_outbox (outbox_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mail_suppressions (
  tenant_id       VARCHAR(63)  NOT NULL,
  recipient_hash  CHAR(64)     NOT NULL,
  reason          VARCHAR(20)  NOT NULL,
  created_at      BIGINT       NOT NULL,
  PRIMARY KEY (tenant_id, recipient_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
