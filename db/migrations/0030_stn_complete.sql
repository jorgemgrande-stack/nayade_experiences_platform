-- Big Elephant — Social Token Net Complete: integración de Comunidades y Tokens internos (aditiva, BD de cada empresa;
-- solo actúa con las capacidades social-token-net y social-token-net-tokens a la vez).
--
-- `loyalty_community_rules`: reglas de puntos por participación en comunidades (tipo de hecho de comunidad, puntos
-- fijos, límite por persona y periodo, comunidad concreta o todas y si se retiran al ocultar o rechazar el contenido).
-- `loyalty_community_awards`: un registro por hecho de comunidad premiado (event_key única: un mismo hecho nunca da
-- puntos dos veces, ni por el aviso inmediato ni por la pasada de recuperación), con su movimiento del libro y su
-- estado (concedido o retirado).
-- `loyalty_community_sync`: posición de la pasada de recuperación sobre community_activity (una fila, id = 1).
-- `loyalty_reward_communities`: recompensas exclusivas para miembros de una o varias comunidades (quitar una comunidad
-- la marca inactiva: active = 0).
-- Las campañas por comunidad usan loyalty_campaigns (alcance 'community' y la comunidad en scope_id).
--
-- Solo crea tablas nuevas. Sin las dos capacidades no se usan. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS loyalty_community_rules (
  id             INT           NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120)  NOT NULL,
  event_type     VARCHAR(32)   NOT NULL,
  community_id   INT           NULL DEFAULT NULL,
  points         INT           NOT NULL,
  limit_count    INT           NULL DEFAULT NULL,
  limit_period   VARCHAR(16)   NULL DEFAULT NULL,
  revoke_hidden  TINYINT(1)    NOT NULL DEFAULT 1,
  priority       INT           NOT NULL DEFAULT 0,
  active         TINYINT(1)    NOT NULL DEFAULT 1,
  starts_at      BIGINT        NULL DEFAULT NULL,
  ends_at        BIGINT        NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_loyalty_community_rules_active (active, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_community_awards (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  event_id       BIGINT        NOT NULL,
  event_key      VARCHAR(160)  NOT NULL,
  event_type     VARCHAR(32)   NOT NULL,
  community_id   INT           NOT NULL,
  user_id        INT           NOT NULL,
  client_id      INT           NOT NULL,
  rule_id        INT           NOT NULL,
  campaign_id    INT           NULL DEFAULT NULL,
  target_type    VARCHAR(16)   NULL DEFAULT NULL,
  target_id      INT           NULL DEFAULT NULL,
  ledger_id      BIGINT        NOT NULL,
  points         INT           NOT NULL,
  status         VARCHAR(12)   NOT NULL DEFAULT 'granted',
  revoked_at     BIGINT        NULL DEFAULT NULL,
  revoke_reason  VARCHAR(300)  NULL DEFAULT NULL,
  occurred_at    BIGINT        NOT NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_loyalty_community_awards_event (event_key),
  KEY idx_loyalty_community_awards_rule (rule_id, client_id, occurred_at),
  KEY idx_loyalty_community_awards_target (target_type, target_id),
  KEY idx_loyalty_community_awards_community (community_id, status),
  KEY idx_loyalty_community_awards_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_community_sync (
  id             INT           NOT NULL,
  last_event_id  BIGINT        NOT NULL DEFAULT 0,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS loyalty_reward_communities (
  reward_id      INT           NOT NULL,
  community_id   INT           NOT NULL,
  active         TINYINT(1)    NOT NULL DEFAULT 1,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (reward_id, community_id),
  KEY idx_loyalty_reward_communities_community (community_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
