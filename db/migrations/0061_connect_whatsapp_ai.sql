-- Elephant WhatsApp AI (server/whatsappCloud/*, capacidad whatsapp-ai): WhatsApp Cloud API de Meta con el número PROPIO de
-- cada empresa (credencial `whatsapp_cloud` de su bóveda). Configuración de la IA (fila única, apagada por defecto),
-- conversaciones por cliente (ventana de 24 h desde su último mensaje), mensajes entrantes y salientes con su estado de
-- entrega (idempotentes por el id de mensaje de Meta) y registro de lo que propuso o envió la IA. Los cupos diarios de
-- respuestas automáticas usan reception_ai_cupos (0057, tipo `whatsapp_auto`). Fuera de drizzle/schema.ts. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id                 TINYINT UNSIGNED NOT NULL,
  ai_mode            VARCHAR(10)      NOT NULL DEFAULT 'off',
  auto_hours         VARCHAR(2000)    NULL,
  auto_daily_limit   INT UNSIGNED     NOT NULL DEFAULT 50,
  handoff_keywords   VARCHAR(400)     NULL,
  extra_rules        VARCHAR(1500)    NULL,
  timezone           VARCHAR(40)      NOT NULL DEFAULT 'Europe/Madrid',
  updated_by         INT              NULL,
  updated_at         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_whatsapp_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  phone_number_id   VARCHAR(32)   NOT NULL,
  wa_id             VARCHAR(32)   NOT NULL,
  customer_name     VARCHAR(160)  NULL,
  status            VARCHAR(10)   NOT NULL DEFAULT 'open',
  needs_human       TINYINT(1)    NOT NULL DEFAULT 0,
  unread_count      INT UNSIGNED  NOT NULL DEFAULT 0,
  last_preview      VARCHAR(200)  NULL,
  last_inbound_at   TIMESTAMP(3)  NULL,
  last_message_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ai_auto_replies   INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_conversations_contact (phone_number_id, wa_id),
  KEY idx_whatsapp_conversations_recent (last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  conversation_id  INT UNSIGNED  NOT NULL,
  wamid            VARCHAR(160)  NULL,
  direction        VARCHAR(3)    NOT NULL,
  kind             VARCHAR(16)   NOT NULL DEFAULT 'text',
  body             VARCHAR(4096) NOT NULL,
  template_name    VARCHAR(512)  NULL,
  origin           VARCHAR(12)   NOT NULL,
  status           VARCHAR(10)   NOT NULL,
  error_code       VARCHAR(16)   NULL,
  error_title      VARCHAR(200)  NULL,
  sent_by          INT           NULL,
  wa_timestamp     TIMESTAMP(3)  NULL,
  status_at        TIMESTAMP(3)  NULL,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_messages_wamid (wamid),
  KEY idx_whatsapp_messages_conversation (conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_ai_log (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  conversation_id  INT UNSIGNED  NOT NULL,
  message_id       INT UNSIGNED  NULL,
  mode             VARCHAR(8)    NOT NULL,
  outcome          VARCHAR(16)   NOT NULL,
  reply            VARCHAR(4096) NULL,
  actor            INT           NULL,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_whatsapp_ai_log_conversation (conversation_id, id),
  KEY idx_whatsapp_ai_log_recent (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
