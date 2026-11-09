-- Elephant Connect · Automatizaciones avanzadas (server/automations/*, capacidad automations-advanced): reglas de la
-- empresa (disparador, condiciones y pasos con retardo), registro de ejecuciones con clave única por regla, entidad y
-- paso (un disparo por entidad y paso: idempotencia entre réplicas y reintentos acotados) y avisos al equipo en el
-- panel. Fuera de drizzle/schema.ts. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS automation_rules (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name             VARCHAR(120)  NOT NULL,
  trigger_key      VARCHAR(40)   NOT NULL,
  conditions_json  TEXT          NOT NULL,
  steps_json       TEXT          NOT NULL,
  enabled          TINYINT(1)    NOT NULL DEFAULT 0,
  enabled_at       BIGINT        NULL,
  daily_cap        INT UNSIGNED  NOT NULL DEFAULT 50,
  template_key     VARCHAR(40)   NULL,
  is_archived      TINYINT(1)    NOT NULL DEFAULT 0,
  created_by       INT           NULL,
  updated_by       INT           NULL,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_automation_rules_enabled (enabled, is_archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_runs (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  rule_id          INT UNSIGNED  NOT NULL,
  entity_type      VARCHAR(16)   NOT NULL,
  entity_id        INT           NOT NULL,
  step_index       TINYINT UNSIGNED NOT NULL,
  action           VARCHAR(16)   NOT NULL,
  status           VARCHAR(12)   NOT NULL,
  reason           VARCHAR(60)   NULL,
  detail           VARCHAR(300)  NULL,
  attempts         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  run_day          CHAR(10)      NOT NULL,
  last_attempt_at  BIGINT        NULL,
  finished_at      BIGINT        NULL,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_automation_runs_step (rule_id, entity_type, entity_id, step_index),
  KEY idx_automation_runs_day (run_day, rule_id, status),
  KEY idx_automation_runs_recent (rule_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_notices (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  rule_id      INT UNSIGNED  NOT NULL,
  run_id       INT UNSIGNED  NULL,
  title        VARCHAR(160)  NOT NULL,
  body         VARCHAR(600)  NULL,
  entity_type  VARCHAR(16)   NOT NULL,
  entity_id    INT           NOT NULL,
  cta_path     VARCHAR(200)  NULL,
  created_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_automation_notices_run (run_id),
  KEY idx_automation_notices_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
