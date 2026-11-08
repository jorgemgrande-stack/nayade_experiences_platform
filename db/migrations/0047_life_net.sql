-- Life Net · organización personal y familiar (server/lifeNetDb.ts, capacidad life-net): datos del hogar y de su
-- titular, miembros (con o sin acceso al panel), agenda compartida, tareas con varios responsables y el registro de
-- recordatorios enviados (idempotente por elemento, miembro y hora). Fechas y horas de pared del hogar como texto
-- (AAAA-MM-DD y AAAA-MM-DD HH:MM): sin conversiones de zona horaria. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS life_settings (
  id                TINYINT UNSIGNED NOT NULL,
  household_name    VARCHAR(160) NULL,
  holder_first_name VARCHAR(100) NOT NULL,
  holder_last_name  VARCHAR(160) NOT NULL,
  holder_tax_id     VARCHAR(20)  NULL,
  time_zone         VARCHAR(64)  NOT NULL DEFAULT 'Europe/Madrid',
  updated_by        INT          NULL,
  updated_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_life_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS life_members (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  display_name VARCHAR(120) NOT NULL,
  relationship VARCHAR(20)  NOT NULL DEFAULT 'otro',
  color        VARCHAR(16)  NOT NULL DEFAULT 'azul',
  user_id      INT          NULL,
  is_holder    TINYINT(1)   NOT NULL DEFAULT 0,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by   INT          NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_life_members_user (user_id),
  KEY idx_life_members_active (is_active, display_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS life_events (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title           VARCHAR(200)  NOT NULL,
  kind            VARCHAR(16)   NOT NULL DEFAULT 'actividad',
  notes           VARCHAR(1000) NULL,
  location        VARCHAR(200)  NULL,
  event_date      CHAR(10)      NOT NULL,
  start_time      CHAR(5)       NULL,
  end_time        CHAR(5)       NULL,
  remind_at       CHAR(16)      NULL,
  is_archived     TINYINT(1)    NOT NULL DEFAULT 0,
  created_by      INT           NULL,
  created_at      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_life_events_date (is_archived, event_date),
  KEY idx_life_events_remind (is_archived, remind_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS life_event_members (
  event_id  INT UNSIGNED NOT NULL,
  member_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (event_id, member_id),
  KEY idx_life_event_members_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS life_tasks (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title              VARCHAR(200)  NOT NULL,
  notes              VARCHAR(1000) NULL,
  due_date           CHAR(10)      NULL,
  due_time           CHAR(5)       NULL,
  remind_at          CHAR(16)      NULL,
  status             VARCHAR(12)   NOT NULL DEFAULT 'pending',
  done_at            TIMESTAMP(3)  NULL,
  done_by_member_id  INT UNSIGNED  NULL,
  done_by_user_id    INT           NULL,
  is_archived        TINYINT(1)    NOT NULL DEFAULT 0,
  created_by         INT           NULL,
  created_at         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_life_tasks_status (is_archived, status, due_date),
  KEY idx_life_tasks_remind (is_archived, status, remind_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS life_task_assignees (
  task_id   INT UNSIGNED NOT NULL,
  member_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (task_id, member_id),
  KEY idx_life_task_assignees_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS life_reminders (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  item_kind  VARCHAR(8)       NOT NULL,
  item_id    INT UNSIGNED     NOT NULL,
  member_id  INT UNSIGNED     NOT NULL,
  remind_at  CHAR(16)         NOT NULL,
  status     VARCHAR(12)      NOT NULL DEFAULT 'sending',
  attempts   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  sent_at    TIMESTAMP(3)     NULL,
  created_at TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_life_reminders_once (item_kind, item_id, member_id, remind_at),
  KEY idx_life_reminders_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
