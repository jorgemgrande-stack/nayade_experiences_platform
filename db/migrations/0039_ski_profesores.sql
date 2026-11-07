-- Ski Net · Profesores (módulo del SDK, server/skiSchool): condiciones de pago y horas exigidas por profesor, vínculo
-- con un usuario del Core (portal del empleado), asistencia por sesión y liquidaciones con sus líneas. Aditiva: solo
-- CREATE TABLE. Nada se borra desde el código: una liquidación cerrada se anula (sus importes no cambian).
CREATE TABLE IF NOT EXISTS ski_school_instructor_profiles (
  instructor_id         INT UNSIGNED NOT NULL,
  site_id               VARCHAR(63)  NOT NULL,
  required_minutes_week INT UNSIGNED NULL,
  pay_mode              VARCHAR(16)  NULL,
  hourly_rate_cents     INT UNSIGNED NULL,
  percent_bp            INT UNSIGNED NULL,
  monthly_cents         INT UNSIGNED NULL,
  user_id               INT          NULL,
  updated_by            VARCHAR(100) NULL,
  updated_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instructor_id),
  UNIQUE KEY uq_ski_school_instructor_profiles_user (user_id),
  KEY idx_ski_school_instructor_profiles_site (site_id),
  CONSTRAINT fk_ski_school_instructor_profiles_instructor FOREIGN KEY (instructor_id) REFERENCES ski_school_instructors (id),
  CONSTRAINT chk_ski_school_instructor_profiles_mode CHECK (pay_mode IS NULL OR pay_mode IN ('hourly', 'percent', 'monthly')),
  CONSTRAINT chk_ski_school_instructor_profiles_percent CHECK (percent_bp IS NULL OR percent_bp <= 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_attendance (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)  NOT NULL,
  session_id     INT UNSIGNED NOT NULL,
  participant_id INT UNSIGNED NOT NULL,
  status         VARCHAR(16)  NOT NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_school_attendance_participant (session_id, participant_id),
  KEY idx_ski_school_attendance_site (site_id, created_at),
  CONSTRAINT fk_ski_school_attendance_session FOREIGN KEY (session_id) REFERENCES ski_school_sessions (id),
  CONSTRAINT fk_ski_school_attendance_participant FOREIGN KEY (participant_id) REFERENCES ski_school_participants (id),
  CONSTRAINT chk_ski_school_attendance_status CHECK (status IN ('present', 'absent', 'late'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_session_closures (
  session_id    INT UNSIGNED NOT NULL,
  site_id       VARCHAR(63)  NOT NULL,
  instructor_id INT UNSIGNED NULL,
  present       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  absent        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  closed_by     VARCHAR(100) NULL,
  closed_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id),
  KEY idx_ski_school_session_closures_site (site_id, closed_at),
  CONSTRAINT fk_ski_school_session_closures_session FOREIGN KEY (session_id) REFERENCES ski_school_sessions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_settlements (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       VARCHAR(63)  NOT NULL,
  instructor_id INT UNSIGNED NOT NULL,
  period_start  DATE         NOT NULL,
  period_end    DATE         NOT NULL,
  pay_mode      VARCHAR(16)  NOT NULL,
  terms         JSON         NOT NULL,
  minutes       INT UNSIGNED NOT NULL,
  sessions      INT UNSIGNED NOT NULL,
  base_cents    INT UNSIGNED NOT NULL,
  total_cents   INT UNSIGNED NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'closed',
  created_by    VARCHAR(100) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  voided_by     VARCHAR(100) NULL,
  voided_at     TIMESTAMP(3) NULL,
  void_reason   VARCHAR(300) NULL,
  PRIMARY KEY (id),
  KEY idx_ski_school_settlements_site (site_id, status, period_start),
  KEY idx_ski_school_settlements_instructor (instructor_id, status, period_start, period_end),
  CONSTRAINT fk_ski_school_settlements_instructor FOREIGN KEY (instructor_id) REFERENCES ski_school_instructors (id),
  CONSTRAINT chk_ski_school_settlements_period CHECK (period_end >= period_start),
  CONSTRAINT chk_ski_school_settlements_status CHECK (status IN ('closed', 'voided')),
  CONSTRAINT chk_ski_school_settlements_mode CHECK (pay_mode IN ('hourly', 'percent', 'monthly'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_settlement_lines (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id         VARCHAR(63)  NOT NULL,
  settlement_id   INT UNSIGNED NOT NULL,
  session_id      INT UNSIGNED NULL,
  session_date    DATE         NULL,
  description     VARCHAR(200) NOT NULL,
  minutes         INT UNSIGNED NOT NULL,
  base_cents      INT UNSIGNED NOT NULL,
  amount_cents    INT UNSIGNED NOT NULL,
  active          TINYINT(1)   NOT NULL DEFAULT 1,
  -- Una sesión solo puede estar en una liquidación vigente: garantía en la propia BD
  open_session_id INT UNSIGNED GENERATED ALWAYS AS (IF(active = 1, session_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_school_settlement_lines_open_session (open_session_id),
  KEY idx_ski_school_settlement_lines_settlement (settlement_id),
  CONSTRAINT fk_ski_school_settlement_lines_settlement FOREIGN KEY (settlement_id) REFERENCES ski_school_settlements (id),
  CONSTRAINT fk_ski_school_settlement_lines_session FOREIGN KEY (session_id) REFERENCES ski_school_sessions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
