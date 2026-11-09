-- Elephant Copilot avanzado (server/copilot/*, capacidad copilot-advanced): historial de conversaciones de cada usuario
-- del panel con el asistente (preguntas sobre los datos de la empresa y borradores de redacción) y sus mensajes,
-- incluidas las herramientas de solo lectura consultadas. Fuera de drizzle/schema.ts. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS copilot_conversations (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        INT           NOT NULL,
  kind           VARCHAR(12)   NOT NULL DEFAULT 'chat',
  title          VARCHAR(120)  NOT NULL,
  message_count  INT UNSIGNED  NOT NULL DEFAULT 0,
  is_archived    TINYINT(1)    NOT NULL DEFAULT 0,
  created_at     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_copilot_conversations_user (user_id, is_archived, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS copilot_messages (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  conversation_id  INT UNSIGNED  NOT NULL,
  user_id          INT           NOT NULL,
  role             VARCHAR(10)   NOT NULL,
  content          TEXT          NOT NULL,
  tools_json       TEXT          NULL,
  tokens_in        INT UNSIGNED  NOT NULL DEFAULT 0,
  tokens_out       INT UNSIGNED  NOT NULL DEFAULT 0,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_copilot_messages_conversation (conversation_id, id),
  KEY idx_copilot_messages_user (user_id, role, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
