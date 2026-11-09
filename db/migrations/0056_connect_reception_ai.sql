-- Elephant Reception AI (server/receptionAi/*, capacidad reception-ai): recepcionista virtual con IA de cada empresa.
-- Configuración (fila única: idioma, tono, datos del negocio, horario de atención humana, reglas de derivación, chat de
-- la web y asistente de Vapi sincronizado), base de conocimiento propia, conversaciones atendidas (llamadas y chat) con
-- su resultado y mensajes del chat y de las herramientas. Fuera de drizzle/schema.ts. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS reception_settings (
  id                 TINYINT UNSIGNED NOT NULL,
  is_enabled         TINYINT(1)       NOT NULL DEFAULT 0,
  assistant_name     VARCHAR(60)      NOT NULL DEFAULT 'Recepción',
  language           VARCHAR(8)       NOT NULL DEFAULT 'es',
  tone               VARCHAR(16)      NOT NULL DEFAULT 'cercano',
  greeting           VARCHAR(400)     NULL,
  business_summary   VARCHAR(1500)    NULL,
  address            VARCHAR(400)     NULL,
  opening_hours      VARCHAR(600)     NULL,
  human_hours        VARCHAR(2000)    NULL,
  timezone           VARCHAR(40)      NOT NULL DEFAULT 'Europe/Madrid',
  include_catalog    TINYINT(1)       NOT NULL DEFAULT 1,
  transfer_enabled   TINYINT(1)       NOT NULL DEFAULT 0,
  transfer_number    VARCHAR(20)      NULL,
  lead_enabled       TINYINT(1)       NOT NULL DEFAULT 1,
  callback_enabled   TINYINT(1)       NOT NULL DEFAULT 1,
  extra_rules        VARCHAR(1500)    NULL,
  chat_enabled       TINYINT(1)       NOT NULL DEFAULT 0,
  chat_key_version   INT UNSIGNED     NOT NULL DEFAULT 1,
  chat_daily_limit   INT UNSIGNED     NOT NULL DEFAULT 100,
  vapi_assistant_id  VARCHAR(80)      NULL,
  vapi_synced_at     TIMESTAMP(3)     NULL,
  vapi_synced_hash   CHAR(64)         NULL,
  updated_by         INT              NULL,
  updated_at         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_reception_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reception_knowledge (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kind         VARCHAR(12)   NOT NULL DEFAULT 'faq',
  question     VARCHAR(300)  NOT NULL,
  answer       VARCHAR(2000) NOT NULL,
  sort_order   SMALLINT      NOT NULL DEFAULT 0,
  is_archived  TINYINT(1)    NOT NULL DEFAULT 0,
  created_by   INT           NULL,
  created_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_reception_knowledge_active (is_archived, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reception_conversations (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  channel           VARCHAR(8)    NOT NULL,
  external_ref      VARCHAR(128)  NOT NULL,
  outcome           VARCHAR(16)   NOT NULL DEFAULT 'open',
  outcome_source    VARCHAR(8)    NOT NULL DEFAULT 'auto',
  customer_name     VARCHAR(160)  NULL,
  customer_phone    VARCHAR(32)   NULL,
  customer_email    VARCHAR(320)  NULL,
  lead_id           INT           NULL,
  summary           VARCHAR(2000) NULL,
  ended_reason      VARCHAR(80)   NULL,
  duration_seconds  INT UNSIGNED  NULL,
  message_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  ai_replies        INT UNSIGNED  NOT NULL DEFAULT 0,
  started_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reception_conversations_ref (channel, external_ref),
  KEY idx_reception_conversations_started (started_at),
  KEY idx_reception_conversations_outcome (outcome, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reception_messages (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  conversation_id  INT UNSIGNED  NOT NULL,
  role             VARCHAR(10)   NOT NULL,
  origin           VARCHAR(10)   NOT NULL DEFAULT 'customer',
  content          VARCHAR(4000) NOT NULL,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_reception_messages_conversation (conversation_id, id),
  KEY idx_reception_messages_daily (origin, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
